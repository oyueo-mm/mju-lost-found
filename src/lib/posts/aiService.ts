import { prisma } from "@/lib/db/prisma";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { EMBEDDING_INPUT_FIELDS, embedPostBestEffort } from "@/lib/ai/postEmbedding";
import { getEmbeddingProvider } from "@/lib/ai/embedding";
import { findPostsBySemanticQuery, findSimilarPostsByImage } from "@/lib/ai/vectorSearch";
import type { User } from "@/generated/prisma/client";
import type {
  CreateFoundPostInput,
  CreateLostPostInput,
  PostListType,
  PostType,
  SearchMode,
  UpdateFoundPostInput,
  UpdateLostPostInput,
} from "./schema";
import {
  AUTHOR_SELECT,
  FOUND_STATUS_TO_DB,
  LOST_STATUS_TO_DB,
  searchPosts as searchPostsKeywordOnly,
  toFoundPostDTO,
  toLostPostDTO,
  totalPagesFor,
  type FoundPostDTO,
  type ListParams,
  type LostPostDTO,
  type PagedResult,
  type PostDTO,
  type PostMutationResult,
} from "./service";

// Phase 21: the AI-dependent half of the old posts/service.ts split (see
// that file's own top-of-file comment). Every function here transitively
// imports @huggingface/transformers (via postEmbedding.ts/embedding.ts),
// so only routes that genuinely need AI at runtime -- /api/posts,
// /api/posts/[id], and (for image similarity) the post detail page --
// import from this file. found/lost/search/posts-mine/post-edit import
// the plain CRUD/keyword functions from ./service instead, which no
// longer traces that dependency at all -- see Phase 20's report for why
// merely having it reachable from the same *file* (even behind a lazy
// `import()`) was enough to bloat every one of those routes' Vercel
// function bundle before this split.

// ---------- Mutations (create/update trigger embedPostBestEffort) ----------

export async function createLostPost(
  author: User,
  input: CreateLostPostInput,
): Promise<PostMutationResult<LostPostDTO>> {
  if (isCurrentlySuspended(author)) {
    return { kind: "forbidden", reason: "suspended" };
  }
  const { status, ...rest } = input;
  const row = await prisma.lostPost.create({
    data: {
      ...rest,
      userId: author.id,
      ...(status !== undefined && { status: LOST_STATUS_TO_DB[status] }),
    },
    include: { user: { select: AUTHOR_SELECT } },
  });
  // Post-commit, best-effort -- see embedPostBestEffort()'s doc comment.
  // A brand-new post always has all four embeddable fields, so this
  // always attempts an embedding (never conditional the way the update
  // path below is).
  await embedPostBestEffort("lost", row.id, row);
  return { kind: "ok", data: toLostPostDTO(row) };
}

export async function updateLostPost(
  id: number,
  userId: number,
  input: UpdateLostPostInput,
): Promise<PostMutationResult<LostPostDTO>> {
  const existing = await prisma.lostPost.findUnique({ where: { id } });
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden", reason: "not_owner" };

  const { status, ...rest } = input;
  const row = await prisma.lostPost.update({
    where: { id },
    data: {
      ...rest,
      ...(status !== undefined && { status: LOST_STATUS_TO_DB[status] }),
    },
    include: { user: { select: AUTHOR_SELECT } },
  });
  // Only re-embed when a field that actually feeds buildEmbeddingText()
  // changed -- e.g. a status-only update (marking a post found/complete)
  // or an image-only change shouldn't burn an inference call for text
  // that's already correctly embedded.
  if (EMBEDDING_INPUT_FIELDS.some((field) => field in rest)) {
    await embedPostBestEffort("lost", row.id, row);
  }
  return { kind: "ok", data: toLostPostDTO(row) };
}

export async function createFoundPost(
  author: User,
  input: CreateFoundPostInput,
): Promise<PostMutationResult<FoundPostDTO>> {
  if (isCurrentlySuspended(author)) {
    return { kind: "forbidden", reason: "suspended" };
  }
  const { status, ...rest } = input;
  const row = await prisma.foundPost.create({
    data: {
      ...rest,
      userId: author.id,
      ...(status !== undefined && { status: FOUND_STATUS_TO_DB[status] }),
    },
    include: { user: { select: AUTHOR_SELECT } },
  });
  await embedPostBestEffort("found", row.id, row);
  return { kind: "ok", data: toFoundPostDTO(row) };
}

export async function updateFoundPost(
  id: number,
  userId: number,
  input: UpdateFoundPostInput,
): Promise<PostMutationResult<FoundPostDTO>> {
  const existing = await prisma.foundPost.findUnique({ where: { id } });
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden", reason: "not_owner" };

  const { status, ...rest } = input;
  const row = await prisma.foundPost.update({
    where: { id },
    data: {
      ...rest,
      ...(status !== undefined && { status: FOUND_STATUS_TO_DB[status] }),
    },
    include: { user: { select: AUTHOR_SELECT } },
  });
  if (EMBEDDING_INPUT_FIELDS.some((field) => field in rest)) {
    await embedPostBestEffort("found", row.id, row);
  }
  return { kind: "ok", data: toFoundPostDTO(row) };
}

// ---------- Semantic search (Phase 12) ----------

// Matches legacy ai/search.py::DEFAULT_TOP_K exactly -- this app's one
// other free-text-query ranking function (the AI-candidate list per post,
// src/lib/match/candidates.ts) uses a different constant (TOP_K = 5) for a
// different purpose (candidate *suggestions* for one specific post, not a
// general search box), so the two aren't unified into one shared value.
const SEMANTIC_SEARCH_TOP_K = 10;

// Phase 13-2: Phase 13-1's real-DB evaluation surfaced a systematic "hard
// negative" failure -- pure cosine similarity sometimes ranks a post whose
// *description* merely mentions the query's subject word above the post
// that word is actually about. Example (reproduced on both boards):
// query "학생증 잃어버렸어요" scored "카드지갑 분실" (description: "...
// 학생증이 들어있어요") at 0.912, just above the correct "학생증 분실1" at
// 0.893 -- a 0.019 gap. A literal title match is a much stronger relevance
// signal than an incidental description mention, so a small bonus is added
// when a query token appears in the post's *title* specifically (never
// description) -- large enough to flip that kind of near-tie, but far
// smaller than the gap between any semantically-correct top result and the
// next candidate observed across Phase 13-1's full query set (every
// clearly-correct case had a >0.05 gap). This is deliberately not a
// general keyword/semantic hybrid score -- see this phase's report for the
// alternatives considered (weighted hybrid score, embedding-input changes)
// and why a narrow, title-only tie-breaker was chosen instead.
const LEXICAL_TITLE_MATCH_BONUS = 0.03;

// Whitespace-split, length>=2 filters out single-character particles
// (은/는/이/가/을/를 standing alone) that would otherwise match almost any
// title. Intentionally not real Korean morphological analysis (no new
// library) -- just enough to catch a literal shared noun like "학생증".
function queryTokens(query: string): string[] {
  return query
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

// mode=semantic's counterpart to listLostPosts()/listFoundPosts() --
// type is narrowed to PostType (never "all") by listQuerySchema's
// superRefine before this is ever called (see searchPosts() below), so
// there is exactly one board's embedding column to rank against; no
// cross-table UNION or in-memory re-merge like ./service's searchAllPosts
// needs.
//
// Deliberately top-K only, not a true DB-wide paginated count (§14 of
// docs/AI_SEMANTIC_SEARCH_DESIGN.md: "top-K 기반으로 동작한다", no
// threshold): `total`/`totalPages` reflect the top-K result set itself,
// not every embedded post that resembles the query even faintly. Page 2+
// of a semantic search simply has no more results past the K best
// matches, which is the intended behavior, not a bug.
async function searchPostsSemantic(
  type: PostType,
  query: string,
  { page, limit, ...filters }: ListParams,
): Promise<PagedResult<PostDTO>> {
  const vector = await getEmbeddingProvider().embed(query);
  const ranked = await findPostsBySemanticQuery(type, vector, SEMANTIC_SEARCH_TOP_K, filters);

  if (ranked.length === 0) {
    return { items: [], page, limit, total: 0, totalPages: 1 };
  }

  const scoreById = new Map(ranked.map((r) => [r.id, r.score]));
  const ids = ranked.map((r) => r.id);
  const rows =
    type === "lost"
      ? await prisma.lostPost.findMany({ where: { id: { in: ids } }, include: { user: { select: AUTHOR_SELECT } } })
      : await prisma.foundPost.findMany({ where: { id: { in: ids } }, include: { user: { select: AUTHOR_SELECT } } });
  const rowById = new Map(rows.map((row) => [row.id, row]));

  // Re-order to match the similarity ranking -- `findMany({id:{in}})` does
  // not preserve the input array's order. A missing row here means the
  // post was deleted in the gap between the vector search and this fetch;
  // it's simply dropped, not an error (the same "best-effort, never
  // surfaced as a failure" spirit as embedPostBestEffort() elsewhere).
  //
  // The lexical title-match bonus (see LEXICAL_TITLE_MATCH_BONUS above) is
  // applied here, not in findPostsBySemanticQuery(), because it needs the
  // post's title text -- vectorSearch.ts only ever sees id+similarity, and
  // stays a pure pgvector-query function. Applying the bonus to `score`
  // itself (rather than only to an internal sort key) keeps the displayed
  // "검색 유사도" percentage consistent with the actual result order.
  const tokens = queryTokens(query);
  const items: PostDTO[] = ids
    .map((id) => rowById.get(id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .map((row) => {
      const dto = type === "lost" ? toLostPostDTO(row as Parameters<typeof toLostPostDTO>[0]) : toFoundPostDTO(row as Parameters<typeof toFoundPostDTO>[0]);
      const baseScore = scoreById.get(row.id) ?? 0;
      const titleMatchesQuery = tokens.some((token) => row.title.includes(token));
      const score = titleMatchesQuery ? Math.min(1, baseScore + LEXICAL_TITLE_MATCH_BONUS) : baseScore;
      return { ...dto, score };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.id - b.id);

  const total = items.length;
  const skip = (page - 1) * limit;
  return { items: items.slice(skip, skip + limit), page, limit, total, totalPages: totalPagesFor(total, limit) };
}

// The AI-aware superset of ./service's plain searchPosts(): the single
// entry point /api/posts's GET handler calls (which is also what
// found/lost/search's pages fetch when mode=semantic, via a server-side
// HTTP request rather than an in-process call -- see searchApiClient.ts).
// listQuerySchema's superRefine already guarantees mode=semantic never
// coexists with type=all and always carries a non-empty q, so no
// re-validation happens here.
export async function searchPosts({
  type,
  mode = "keyword",
  q,
  ...params
}: ListParams & { type: PostListType; mode?: SearchMode }): Promise<PagedResult<PostDTO>> {
  if (mode === "semantic") {
    // q is guaranteed non-empty here by listQuerySchema's superRefine.
    return searchPostsSemantic(type as PostType, q as string, params);
  }
  return searchPostsKeywordOnly({ type, q, ...params });
}

// ---------- Image similarity search (Phase 15-2) ----------

// Matches SEMANTIC_SEARCH_TOP_K's precedent (Phase 12): the AI-ranking
// list this feeds is a capped top-K recommendation, not a paginated "all
// matching results" set -- there is no pagination UI for it at all (see
// the post detail page), only a fixed small card grid, so a separate,
// smaller display cap is applied on top of it.
const IMAGE_SIMILARITY_TOP_K = 10;
// How many cards actually render on the post detail page -- kept well
// below IMAGE_SIMILARITY_TOP_K so "이 사진과 비슷한 게시물" stays a compact
// strip, not a second full results page, regardless of how many candidates
// exist.
const IMAGE_SIMILARITY_DISPLAY_LIMIT = 6;

// Post-detail-page counterpart to searchPostsSemantic() above: given a
// post that already has an image (and, best-effort, an imageEmbedding --
// see embedPostImageBestEffort()), finds visually similar posts on the
// *other* board (Lost's image -> Found candidates, Found's image -> Lost
// candidates; see findSimilarPostsByImage()'s own comment for why never
// the same board) and returns them as fully-hydrated DTOs with `score` set
// to the image-similarity value. Returns an empty array -- never throws --
// when the source post has no imageEmbedding yet or there are no
// candidates; the caller (post/[id]/page.tsx) treats both the same way:
// simply don't render the section, matching this phase's explicit "이미지
// embedding이 아직 생성되지 않은 경우에도 빈 AI 섹션을 표시하지 않는다"
// requirement.
export async function findSimilarPostsByImageForDisplay(
  sourceType: PostType,
  sourcePostId: number,
): Promise<PostDTO[]> {
  const targetType: PostType = sourceType === "lost" ? "found" : "lost";
  const ranked = await findSimilarPostsByImage(sourceType, sourcePostId, IMAGE_SIMILARITY_TOP_K);
  if (ranked.length === 0) return [];

  const scoreById = new Map(ranked.map((r) => [r.id, r.score]));
  const ids = ranked.map((r) => r.id);
  const rows =
    targetType === "lost"
      ? await prisma.lostPost.findMany({ where: { id: { in: ids } }, include: { user: { select: AUTHOR_SELECT } } })
      : await prisma.foundPost.findMany({ where: { id: { in: ids } }, include: { user: { select: AUTHOR_SELECT } } });
  const rowById = new Map(rows.map((row) => [row.id, row]));

  // Re-order to match the similarity ranking (findMany({id:{in}}) doesn't
  // preserve it) and drop any id whose row vanished between the two
  // queries -- same reasoning as searchPostsSemantic() above.
  return ids
    .map((id) => rowById.get(id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .map((row) => {
      const dto =
        targetType === "lost"
          ? toLostPostDTO(row as Parameters<typeof toLostPostDTO>[0])
          : toFoundPostDTO(row as Parameters<typeof toFoundPostDTO>[0]);
      return { ...dto, score: scoreById.get(row.id) };
    })
    .slice(0, IMAGE_SIMILARITY_DISPLAY_LIMIT);
}
