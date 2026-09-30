import { after } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { EMBEDDING_INPUT_FIELDS, embedPostBestEffort } from "@/lib/ai/postEmbedding";
import { getEmbeddingProvider } from "@/lib/ai/embedding";
import { getImageEmbeddingProvider } from "@/lib/ai/imageEmbedding";
import { findCandidateCosinesForQuery, findPostsByImageQuery, findPostsBySemanticQuery } from "@/lib/ai/vectorSearch";
import { aiSimilarity, candidatePool, rankByAiSimilarity } from "@/lib/ai/rankFusion";
import { cosineFromNormalizedScore } from "@/lib/ai/matching";
import { invalidateRecommendationCache } from "@/lib/recommendation/service";
import { validateOrganizationPosting } from "@/lib/organization/service";
import { notifyKeywordAlertSubscribers } from "@/lib/keywordAlert/matcher";
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
  POST_ORGANIZATION_SELECT,
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

// 카테고리 대분류-소분류: the schema derives the legacy `category` from
// categoryCode on every category change (dual-write), so a subcategory-only
// edit still carries `category` -- with the same value the post already
// has. Dropping it keeps the embedding-trigger check below
// (EMBEDDING_INPUT_FIELDS, which includes "category") from re-embedding
// text that didn't change.
function dropUnchangedLegacyCategory<T extends { category?: string }>(input: T, existingCategory: string): T {
  if (input.category === undefined || input.category !== existingCategory) return input;
  const rest = { ...input };
  delete rest.category;
  return rest;
}

export async function createLostPost(
  author: User,
  input: CreateLostPostInput,
): Promise<PostMutationResult<LostPostDTO>> {
  if (isCurrentlySuspended(author)) {
    return { kind: "forbidden", reason: "suspended" };
  }
  // Phase 12-5 §6/§8: organizationId === null/undefined means an ordinary
  // personal post -- existing behavior, no extra check. A non-null value
  // is never trusted as-is: validateOrganizationPosting() re-derives
  // existence/ACTIVE/membership from the DB every time (never from
  // anything the client claims about its own role).
  if (input.organizationId != null) {
    const check = await validateOrganizationPosting(author.id, input.organizationId);
    if (check.kind === "not_found") return { kind: "forbidden", reason: "organization_not_found" };
    if (check.kind === "inactive_organization") return { kind: "forbidden", reason: "organization_inactive" };
    if (check.kind === "forbidden") return { kind: "forbidden", reason: "organization_not_member" };
  }
  const { status, ...rest } = input;
  const row = await prisma.lostPost.create({
    data: {
      ...rest,
      userId: author.id,
      ...(status !== undefined && { status: LOST_STATUS_TO_DB[status] }),
    },
    include: { user: { select: AUTHOR_SELECT }, organization: { select: POST_ORGANIZATION_SELECT } },
  });
  // Post-commit, best-effort -- see embedPostBestEffort()'s doc comment.
  // A brand-new post always has all four embeddable fields, so this
  // always attempts an embedding (never conditional the way the update
  // path below is).
  //
  // Phase H-5-1: moved off the request's blocking path via next/server's
  // after() -- the response below now returns as soon as the DB row is
  // committed, and this runs afterward in the same Vercel invocation
  // (after() keeps the function alive for it, unlike a bare
  // fire-and-forget promise, which a serverless runtime can kill the
  // instant the response is sent). "Best-effort" already meant errors
  // here never fail the request (see embedPostBestEffort's own try/catch);
  // this only changes *when* it runs, not whether a failure is still
  // silently logged and swallowed -- identical failure behavior, just no
  // longer awaited before the client gets its response.
  after(() => embedPostBestEffort("lost", row.id, row));
  // 키워드 알림 Phase: 같은 post-commit/best-effort/after() 원칙 -- 이
  // 매칭이 실패해도(matcher.ts 자체가 절대 throw하지 않지만, 방어적으로
  // 여기서도 이 응답을 막지 않는다) 게시글 작성 자체는 이미 끝난 뒤다.
  after(() =>
    notifyKeywordAlertSubscribers("lost", {
      id: row.id,
      userId: row.userId,
      title: row.title,
      description: row.description,
      campus: row.campus,
      category: row.category,
    }),
  );
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

  // Phase 12-7 §4: organizationId is now editable -- omitted means "leave
  // attribution unchanged" (input.organizationId is simply absent, so
  // `rest` below never carries the key and Prisma leaves the column
  // untouched); explicit null means "개인"; a positive integer is
  // re-validated fresh against the *current* user's membership every time
  // (never trusted merely because it matches the post's existing value --
  // the editor might not even be a member of that organization any more).
  // Same validateOrganizationPosting() gate as createLostPost's own.
  if (input.organizationId != null) {
    const check = await validateOrganizationPosting(userId, input.organizationId);
    if (check.kind === "not_found") return { kind: "forbidden", reason: "organization_not_found" };
    if (check.kind === "inactive_organization") return { kind: "forbidden", reason: "organization_inactive" };
    if (check.kind === "forbidden") return { kind: "forbidden", reason: "organization_not_member" };
  }

  const { status, ...rest } = dropUnchangedLegacyCategory(input, existing.category);
  const row = await prisma.lostPost.update({
    where: { id },
    data: {
      ...rest,
      ...(status !== undefined && { status: LOST_STATUS_TO_DB[status] }),
    },
    include: { user: { select: AUTHOR_SELECT }, organization: { select: POST_ORGANIZATION_SELECT } },
  });
  // Only re-embed when a field that actually feeds buildEmbeddingText()
  // changed -- e.g. a status-only update (marking a post found/complete)
  // or an image-only change shouldn't burn an inference call for text
  // that's already correctly embedded.
  //
  // Phase H-5-1: both the re-embed and its cache invalidation move into
  // the same after() callback, in the same relative order they already
  // ran in (embed, then invalidate) -- keeping them together (rather than
  // only deferring embedPostBestEffort) avoids a new race where the stale
  // recommendation-cache row is cleared *before* the new embedding is
  // actually saved, which could let a recommendation lookup that lands in
  // that gap recompute against the old vector and re-cache it. See
  // createLostPost's own comment for why after() (not a bare
  // fire-and-forget promise) is what makes this safe on Vercel.
  if (EMBEDDING_INPUT_FIELDS.some((field) => field in rest)) {
    after(async () => {
      await embedPostBestEffort("lost", row.id, row);
      await invalidateRecommendationCache("lost", row.id);
    });
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
  // See createLostPost's own comment -- identical shape/reasoning.
  if (input.organizationId != null) {
    const check = await validateOrganizationPosting(author.id, input.organizationId);
    if (check.kind === "not_found") return { kind: "forbidden", reason: "organization_not_found" };
    if (check.kind === "inactive_organization") return { kind: "forbidden", reason: "organization_inactive" };
    if (check.kind === "forbidden") return { kind: "forbidden", reason: "organization_not_member" };
  }
  const { status, ...rest } = input;
  const row = await prisma.foundPost.create({
    data: {
      ...rest,
      userId: author.id,
      ...(status !== undefined && { status: FOUND_STATUS_TO_DB[status] }),
    },
    include: { user: { select: AUTHOR_SELECT }, organization: { select: POST_ORGANIZATION_SELECT } },
  });
  // Phase H-5-1: see createLostPost's own comment -- same after()
  // deferral, same unchanged failure behavior.
  after(() => embedPostBestEffort("found", row.id, row));
  // 키워드 알림 Phase: see createLostPost's own comment.
  after(() =>
    notifyKeywordAlertSubscribers("found", {
      id: row.id,
      userId: row.userId,
      title: row.title,
      description: row.description,
      campus: row.campus,
      category: row.category,
    }),
  );
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

  // See updateLostPost's own comment -- identical shape/reasoning.
  if (input.organizationId != null) {
    const check = await validateOrganizationPosting(userId, input.organizationId);
    if (check.kind === "not_found") return { kind: "forbidden", reason: "organization_not_found" };
    if (check.kind === "inactive_organization") return { kind: "forbidden", reason: "organization_inactive" };
    if (check.kind === "forbidden") return { kind: "forbidden", reason: "organization_not_member" };
  }

  const { status, ...rest } = dropUnchangedLegacyCategory(input, existing.category);
  const row = await prisma.foundPost.update({
    where: { id },
    data: {
      ...rest,
      ...(status !== undefined && { status: FOUND_STATUS_TO_DB[status] }),
    },
    include: { user: { select: AUTHOR_SELECT }, organization: { select: POST_ORGANIZATION_SELECT } },
  });
  // Phase H-5-1: see updateLostPost's own comment -- embed + invalidate
  // moved together into after(), same relative order, same failure
  // handling.
  if (EMBEDDING_INPUT_FIELDS.some((field) => field in rest)) {
    after(async () => {
      await embedPostBestEffort("found", row.id, row);
      await invalidateRecommendationCache("found", row.id);
    });
  }
  return { kind: "ok", data: toFoundPostDTO(row) };
}

// ---------- Semantic search (Phase 12) ----------

// Matches legacy ai/search.py::DEFAULT_TOP_K exactly -- the app's other
// ranking entry point (per-post AI recommendations,
// src/lib/recommendation/service.ts) uses a different constant (TOP_K = 5)
// for a different purpose (suggestions for one specific post, not a
// general search box), so the two aren't unified into one shared value.
const SEMANTIC_SEARCH_TOP_K = 10;

// Vector search returns normalized cosine similarity, not pgvector distance:
// vectorSearch.ts converts `1 - (embedding <=> query)` through normalizeScore
// into the shared [0, 1] scale. The measured semantic pairs in the project
// were about 0.63 cosine for a relevant pair and 0.28 for an unrelated pair.
// 0.65 on the normalized scale (cosine about 0.30) keeps the relevant pair
// while still excluding the measured unrelated pair. Keyword search never
// uses this threshold.
export const AI_SEARCH_MIN_SIMILARITY = 0.65;

export function filterAiSearchResults<T extends { score: number }>(results: T[]): T[] {
  return results.filter((result) => result.score >= AI_SEARCH_MIN_SIMILARITY);
}

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

// AI 유사도 척도 통일 Phase: which number a single-signal search result
// carries as `score`. Only the displayed value differs -- the ranking,
// the AI_SEARCH_MIN_SIMILARITY filter and the title bonus are identical
// either way.
// - "search": the legacy mode=semantic / mode=image endpoints' own
//   normalizeScore'd cosine (+ the text title bonus), shown as
//   "검색 유사도 XX%" on the /lost, /found and /search pages.
// - "ai": AI 검색 (searchPostsAI) -- rankFusion.ts's D3 formula applied to
//   the same raw cosine. The title bonus is a ranking tie-breaker, not
//   similarity, so it's never added to it. Since the AI 검색 점수 숨김 Phase
//   the UI no longer displays this value (AISearchPanel): a query <-> post
//   D3 runs lower than the post <-> post D3 the AI 추천 shows, so the same
//   number would not mean the same thing. It stays in the API response.
type SearchScoreScale = "search" | "ai";

function aiSimilarityForSignal(signal: "text" | "image", normalizedScore: number): number {
  const cosine = cosineFromNormalizedScore(normalizedScore);
  return aiSimilarity(signal === "text" ? cosine : null, signal === "image" ? cosine : null)!.score;
}

// Shared by searchPostsSemantic() (single board) and
// searchPostsSemanticAll() (Phase 11-2, both boards merged) -- ranks one
// board's embedding column against an already-embedded query vector and
// hydrates the matching rows into scored DTOs. Returns an unsorted,
// unpaginated array; both callers own their own sort/slice, since
// searchPostsSemanticAll's sort has to happen *after* concatenating both
// boards' candidates, not per-board.
//
// Each item carries `rankScore` (the sort key: normalized cosine + title
// bonus) separately from `score` (what's displayed, per `scoreScale`) --
// both callers sort by rankScore and then drop it via withoutRankScore().
type RankedSemanticItem = PostDTO & { score: number; rankScore: number };

function withoutRankScore(item: RankedSemanticItem): PostDTO {
  const { rankScore, ...dto } = item;
  void rankScore;
  return dto;
}

async function rankSemanticCandidates(
  type: PostType,
  queryVector: number[],
  query: string,
  filters: Omit<ListParams, "page" | "limit">,
  scoreScale: SearchScoreScale,
): Promise<RankedSemanticItem[]> {
  const ranked = filterAiSearchResults(await findPostsBySemanticQuery(type, queryVector, SEMANTIC_SEARCH_TOP_K, filters));
  if (ranked.length === 0) return [];

  const scoreById = new Map(ranked.map((r) => [r.id, r.score]));
  const ids = ranked.map((r) => r.id);
  const rows =
    type === "lost"
      ? await prisma.lostPost.findMany({ where: { id: { in: ids } }, include: { user: { select: AUTHOR_SELECT }, organization: { select: POST_ORGANIZATION_SELECT } } })
      : await prisma.foundPost.findMany({ where: { id: { in: ids } }, include: { user: { select: AUTHOR_SELECT }, organization: { select: POST_ORGANIZATION_SELECT } } });
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
  // stays a pure pgvector-query function. On the "search" scale the bonus
  // is part of the displayed score too, which keeps the "검색 유사도"
  // percentage consistent with the actual result order. On the "ai" scale
  // it only reorders -- AI 유사도 stays pure similarity (see
  // SearchScoreScale), so a bonus-promoted result can show a slightly lower
  // AI 유사도 than the one below it.
  const tokens = queryTokens(query);
  return ids
    .map((id) => rowById.get(id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .map((row) => {
      const dto = type === "lost" ? toLostPostDTO(row as Parameters<typeof toLostPostDTO>[0]) : toFoundPostDTO(row as Parameters<typeof toFoundPostDTO>[0]);
      const baseScore = scoreById.get(row.id) ?? 0;
      const titleMatchesQuery = tokens.some((token) => row.title.includes(token));
      const rankScore = titleMatchesQuery ? Math.min(1, baseScore + LEXICAL_TITLE_MATCH_BONUS) : baseScore;
      const score = scoreScale === "ai" ? aiSimilarityForSignal("text", baseScore) : rankScore;
      return { ...dto, score, rankScore };
    });
}

// mode=semantic's counterpart to listLostPosts()/listFoundPosts() -- one
// board's embedding column, ranked and paginated within that board's own
// top-K (§14 of docs/AI_SEMANTIC_SEARCH_DESIGN.md: "top-K 기반으로 동작한다",
// no threshold, so `total`/`totalPages` reflect the top-K result set
// itself, not every embedded post that resembles the query even faintly --
// page 2+ simply has no more results past the K best matches, which is
// the intended behavior, not a bug).
async function searchPostsSemantic(
  type: PostType,
  query: string,
  { page, limit, ...filters }: ListParams,
  scoreScale: SearchScoreScale = "search",
): Promise<PagedResult<PostDTO>> {
  const vector = await getEmbeddingProvider().embed(query);
  const items = (await rankSemanticCandidates(type, vector, query, filters, scoreScale))
    .sort((a, b) => b.rankScore - a.rankScore || a.id - b.id)
    .map(withoutRankScore);

  const total = items.length;
  const skip = (page - 1) * limit;
  return { items: items.slice(skip, skip + limit), page, limit, total, totalPages: totalPagesFor(total, limit) };
}

// Phase 11-2: type=all's semantic counterpart -- ranks LostPost and
// FoundPost independently (one embedding query vector, shared between
// both) and merges by score, not by simple concatenation. This is exact,
// not an approximation: since both boards are each capped at their own
// top-`SEMANTIC_SEARCH_TOP_K`, and the true combined top-K can only ever
// contain posts that are *also* within their own board's top-K (a post
// ranked K+1st or worse on its own board cannot be in a combined top-K
// that's no larger than K), fetching each board's own top-K first and
// merging afterward always yields the correct combined ranking -- no
// cross-table pgvector UNION needed, matching this schema's own
// documented reason for not having one (see listQuerySchema's superRefine
// comment on this same combination). Same top-K-only pagination semantics
// as searchPostsSemantic() above, just over the merged set.
//
// Promise.allSettled (not Promise.all) so one board's own query failing
// doesn't sink a result the other board could still legitimately return
// -- "한쪽 결과 없음" (empty) and "한쪽 검색 실패" (rejected) are kept
// distinct on purpose: an empty board contributes nothing and the other
// board's real results still come back; a *failed* board is logged and
// still degrades to the other board's results rather than a full 500,
// unless both fail, in which case there is genuinely nothing to show and
// the original error is rethrown -- the same "surface a real failure,
// don't paper over total failure" rule embedPostBestEffort()'s own
// "best-effort" comments describe for a different (write-path) case.
async function searchPostsSemanticAll(
  query: string,
  { page, limit, ...filters }: ListParams,
  scoreScale: SearchScoreScale = "search",
): Promise<PagedResult<PostDTO>> {
  const vector = await getEmbeddingProvider().embed(query);
  const [lostResult, foundResult] = await Promise.allSettled([
    rankSemanticCandidates("lost", vector, query, filters, scoreScale),
    rankSemanticCandidates("found", vector, query, filters, scoreScale),
  ]);

  if (lostResult.status === "rejected") {
    console.error("Semantic search failed for lost posts (type=all):", lostResult.reason);
  }
  if (foundResult.status === "rejected") {
    console.error("Semantic search failed for found posts (type=all):", foundResult.reason);
  }
  if (lostResult.status === "rejected" && foundResult.status === "rejected") {
    throw lostResult.reason;
  }

  const lostItems = lostResult.status === "fulfilled" ? lostResult.value : [];
  const foundItems = foundResult.status === "fulfilled" ? foundResult.value : [];
  const items = [...lostItems, ...foundItems]
    .sort((a, b) => b.rankScore - a.rankScore || a.id - b.id)
    .map(withoutRankScore);

  const total = items.length;
  const skip = (page - 1) * limit;
  return { items: items.slice(skip, skip + limit), page, limit, total, totalPages: totalPagesFor(total, limit) };
}

// The AI-aware superset of ./service's plain searchPosts(): the single
// entry point /api/posts's GET handler calls (which is also what
// found/lost/search's pages fetch when mode=semantic, via a server-side
// HTTP request rather than an in-process call -- see searchApiClient.ts).
// listQuerySchema's superRefine already guarantees mode=semantic always
// carries a non-empty q, so no re-validation happens here. type=all is
// now valid for mode=semantic too (Phase 11-2) -- routed to
// searchPostsSemanticAll() instead of being rejected upstream.
export async function searchPosts({
  type,
  mode = "keyword",
  q,
  ...params
}: ListParams & { type: PostListType; mode?: SearchMode }): Promise<PagedResult<PostDTO>> {
  if (mode === "semantic") {
    // q is guaranteed non-empty here by listQuerySchema's superRefine.
    if (type === "all") return searchPostsSemanticAll(q as string, params);
    return searchPostsSemantic(type, q as string, params);
  }
  return searchPostsKeywordOnly({ type, q, ...params });
}

// ---------- Image search (Phase 32) ----------

// Same precedent as SEMANTIC_SEARCH_TOP_K/IMAGE_SIMILARITY_TOP_K above --
// a capped top-K ranking, not a true DB-wide paginated count (same
// reasoning as searchPostsSemantic's own comment on this).
const IMAGE_SEARCH_TOP_K = 10;

// mode=image's counterpart to searchPostsSemantic() above -- the query is
// an uploaded photo (never a stored post's own image), embedded on the fly
// and ranked against `targetType`'s own imageEmbedding column via
// findPostsByImageQuery (searches the board the caller picked, never the
// cross-board "AirPods lost -> AirPods found" convention
// findSimilarPostsByImage() and src/lib/recommendation/service.ts use for
// the post-detail-page AI recommendation feature -- those two features
// solve different problems and deliberately stay separate). No lexical
// tie-breaker here (that's specific to text titles, see
// searchPostsSemantic's own comment) -- pure cosine ranking.
export async function searchPostsByImage(
  targetType: PostType,
  image: Blob,
  { page, limit, ...filters }: ListParams,
  scoreScale: SearchScoreScale = "search",
): Promise<PagedResult<PostDTO>> {
  const vector = await getImageEmbeddingProvider().embed(image);
  const ranked = filterAiSearchResults(await findPostsByImageQuery(targetType, vector, IMAGE_SEARCH_TOP_K, filters));

  if (ranked.length === 0) {
    return { items: [], page, limit, total: 0, totalPages: 1 };
  }

  const scoreById = new Map(ranked.map((r) => [r.id, r.score]));
  const ids = ranked.map((r) => r.id);
  const rows =
    targetType === "lost"
      ? await prisma.lostPost.findMany({ where: { id: { in: ids } }, include: { user: { select: AUTHOR_SELECT }, organization: { select: POST_ORGANIZATION_SELECT } } })
      : await prisma.foundPost.findMany({ where: { id: { in: ids } }, include: { user: { select: AUTHOR_SELECT }, organization: { select: POST_ORGANIZATION_SELECT } } });
  const rowById = new Map(rows.map((row) => [row.id, row]));

  // Re-order to match the similarity ranking and drop any id whose row
  // vanished between the two queries -- same reasoning as
  // searchPostsSemantic()'s own identical comment. The displayed score is
  // a monotonic function of the ranking score on either scale, so the
  // order and the numbers always agree here.
  const items: PostDTO[] = ids
    .map((id) => rowById.get(id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .map((row) => {
      const dto =
        targetType === "lost"
          ? toLostPostDTO(row as Parameters<typeof toLostPostDTO>[0])
          : toFoundPostDTO(row as Parameters<typeof toFoundPostDTO>[0]);
      const normalizedScore = scoreById.get(row.id) ?? 0;
      return { ...dto, score: scoreScale === "ai" ? aiSimilarityForSignal("image", normalizedScore) : normalizedScore };
    });

  const total = items.length;
  const skip = (page - 1) * limit;
  return { items: items.slice(skip, skip + limit), page, limit, total, totalPages: totalPagesFor(total, limit) };
}

// ---------- AI search: text + optional image (AI 검색 고도화 Phase) ----------

// One entry point for "AI 검색" (텍스트 선택, 이미지 선택, 둘 중 하나 이상
// 필요) -- deliberately built out of the exact pieces already above rather
// than a new ranking algorithm:
//   텍스트만        -> searchPostsSemantic()/searchPostsSemanticAll() 그대로
//                       재사용 (type=all도 기존과 동일하게 가능).
//   이미지만        -> searchPostsByImage() 그대로 재사용 (기존과 동일하게
//                       type=all은 불가 -- 이미지 검색은 항상 특정 게시판
//                       하나의 imageEmbedding 컬럼만 조회할 수 있다).
//   텍스트 + 이미지 -> findPostsBySemanticQuery()/findPostsByImageQuery()를
//                       병렬로 돌리고(각 후보는 먼저 동일한 normalized-score
//                       threshold를 통과해야 한다), 두 결과의 합집합을
//                       src/lib/recommendation/service.ts의 게시글 상세 AI
//                       추천과 완전히 같은 rankFusion.rankByAiSimilarity()
//                       (D3-pool)로 정렬한다.
// AI 유사도 척도 통일 Phase: 세 경우 모두 반환되는 score는 rankFusion.ts의
// D3 식으로 계산한 값이다(텍스트만/이미지만은 scoreScale="ai"로 점수만 D3로
// 바꾸고 순위는 그대로). 다만 검색어↔게시글 D3는 AI 추천의 게시글↔게시글
// D3보다 낮게 나오므로, AI 검색 점수 숨김 Phase부터 화면에는 표시하지
// 않는다(AISearchPanel). 같은 함수를 쓰는 기존 mode=semantic / mode=image
// 엔드포인트는 여전히 "검색 유사도 XX%" 척도(scoreScale="search")다.
// 호출자(POST /api/posts?mode=ai)가 "텍스트/이미지 둘 다 없음"과 "이미지가
// 있는데 type=all"을 이미 400으로 거른 뒤에만 이 함수를 부르므로, 그 두
// 불변조건은 여기서 다시 검증하지 않는다(대신 방어적으로 assert만 한다).
export async function searchPostsAI(
  type: PostListType,
  query: string | undefined,
  image: Blob | undefined,
  { page, limit, ...filters }: ListParams,
): Promise<PagedResult<PostDTO>> {
  const trimmedQuery = query?.trim();
  const hasQuery = !!trimmedQuery;
  const hasImage = !!image;

  if (!hasQuery && !hasImage) {
    throw new Error("searchPostsAI requires a query, an image, or both");
  }

  if (hasQuery && !hasImage) {
    return type === "all"
      ? searchPostsSemanticAll(trimmedQuery, { page, limit, ...filters }, "ai")
      : searchPostsSemantic(type, trimmedQuery, { page, limit, ...filters }, "ai");
  }

  if (hasImage && !hasQuery) {
    if (type === "all") throw new Error("Image search requires a specific board (lost or found)");
    return searchPostsByImage(type, image, { page, limit, ...filters }, "ai");
  }

  if (type === "all") throw new Error("Image search requires a specific board (lost or found)");
  return searchPostsByTextAndImage(type, trimmedQuery as string, image as Blob, { page, limit, ...filters });
}

async function searchPostsByTextAndImage(
  targetType: PostType,
  query: string,
  image: Blob,
  { page, limit, ...filters }: ListParams,
): Promise<PagedResult<PostDTO>> {
  const [textVector, imageVector] = await Promise.all([
    getEmbeddingProvider().embed(query),
    getImageEmbeddingProvider().embed(image),
  ]);
  const [textRanked, imageRanked] = await Promise.all([
    findPostsBySemanticQuery(targetType, textVector, SEMANTIC_SEARCH_TOP_K, filters).then(filterAiSearchResults),
    findPostsByImageQuery(targetType, imageVector, IMAGE_SEARCH_TOP_K, filters).then(filterAiSearchResults),
  ]);
  const pool = candidatePool(textRanked, imageRanked);

  if (pool.length === 0) {
    return { items: [], page, limit, total: 0, totalPages: 1 };
  }

  const combined = rankByAiSimilarity(await findCandidateCosinesForQuery(targetType, textVector, imageVector, pool));
  const scoreById = new Map(combined.map((r) => [r.id, r.score]));
  const ids = combined.map((r) => r.id);
  const rows =
    targetType === "lost"
      ? await prisma.lostPost.findMany({ where: { id: { in: ids } }, include: { user: { select: AUTHOR_SELECT }, organization: { select: POST_ORGANIZATION_SELECT } } })
      : await prisma.foundPost.findMany({ where: { id: { in: ids } }, include: { user: { select: AUTHOR_SELECT }, organization: { select: POST_ORGANIZATION_SELECT } } });
  const rowById = new Map(rows.map((row) => [row.id, row]));

  // Re-order to match the combined ranking and drop any id whose row
  // vanished between the vector searches and this fetch -- same reasoning
  // as searchPostsByImage()'s own identical comment.
  const items: PostDTO[] = ids
    .map((id) => rowById.get(id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .map((row) => {
      const dto =
        targetType === "lost"
          ? toLostPostDTO(row as Parameters<typeof toLostPostDTO>[0])
          : toFoundPostDTO(row as Parameters<typeof toFoundPostDTO>[0]);
      return { ...dto, score: scoreById.get(row.id) };
    });

  const total = items.length;
  const skip = (page - 1) * limit;
  return { items: items.slice(skip, skip + limit), page, limit, total, totalPages: totalPagesFor(total, limit) };
}
