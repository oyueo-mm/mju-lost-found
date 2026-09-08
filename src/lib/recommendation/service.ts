import { prisma } from "@/lib/db/prisma";
import {
  EmbeddingNotAvailableError,
  findSimilarPosts,
  findSimilarPostsByImage,
  type VectorSearchResult,
} from "@/lib/ai/vectorSearch";
import { AUTHOR_SELECT, toFoundPostDTO, toLostPostDTO, type PostDTO } from "@/lib/posts/service";
import type { PostType } from "@/lib/posts/schema";

// Phase J-2: replaces the removed Match domain's findMatchCandidates()
// (src/lib/match/candidates.ts, deleted) -- same "current post -> opposite
// board, Top-K, cached in MatchCandidateCache" shape, but public (no
// ownership check: every viewer of a post detail page sees the same
// recommendations, matching how SimilarPostsSection already behaved before
// this phase) and combining both text and image similarity instead of text
// only. Reuses findSimilarPosts()/findSimilarPostsByImage() (the exact same
// pgvector queries the Match domain's candidate search already ran)
// unchanged -- no AI model or ranking algorithm changed by this phase.
const TOP_K = 5;

type RankedCandidate = { id: number; score: number };

// Only {id, score} is cached, never the hydrated post row -- so a cached
// ranking can never show a stale title/status, or a since-deleted post: the
// actual LostPost/FoundPost rows are always re-fetched fresh on every read
// below, and a since-deleted id simply drops out of the `findMany` result.
// What IS cached (and can go stale) is the *ranking itself*, invalidated
// the same way the old Match-candidate cache was -- see
// invalidateRecommendationCache()'s callers.
// The rows written before Phase J-2 hold the old Match-candidate shape
// ({postId, type, title, ...}), not this one. The removal migration clears
// them, but a row in the wrong shape is treated as a cache miss here too,
// so the feature degrades to "recompute" instead of erroring on `undefined`
// ids if one ever shows up again (e.g. an old instance writing one during a
// rolling deploy).
function isRankedCandidateList(value: unknown): value is RankedCandidate[] {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === "object" && v !== null && typeof (v as RankedCandidate).id === "number")
  );
}

async function readCachedRanking(sourceType: PostType, sourcePostId: number): Promise<RankedCandidate[] | null> {
  const cached = await prisma.matchCandidateCache.findUnique({
    where: { sourceType_sourcePostId: { sourceType, sourcePostId } },
  });
  if (!cached) return null;
  return isRankedCandidateList(cached.candidates) ? cached.candidates : null;
}

async function writeCachedRanking(
  sourceType: PostType,
  sourcePostId: number,
  ranking: RankedCandidate[],
): Promise<void> {
  await prisma.matchCandidateCache.upsert({
    where: { sourceType_sourcePostId: { sourceType, sourcePostId } },
    create: { sourceType, sourcePostId, candidates: ranking as unknown as object },
    update: { candidates: ranking as unknown as object, computedAt: new Date() },
  });
}

// Called wherever a post's text or image embedding is recomputed (see
// src/lib/posts/aiService.ts and the PUT /api/posts/[id] image-embedding
// trigger) -- a changed embedding can change what this post's
// recommendations should be. Same "a new post appearing on the opposite
// board does not invalidate an existing cache row" accepted staleness
// trade-off the removed Match domain's cache already had (see
// schema.prisma's MatchCandidateCache comment).
export async function invalidateRecommendationCache(sourceType: PostType, sourcePostId: number): Promise<void> {
  await prisma.matchCandidateCache.deleteMany({ where: { sourceType, sourcePostId } });
}

// Phase J-2 section 6: combines a candidate's text score and image score by
// plain unweighted average when both are present, or uses whichever single
// score is present otherwise -- "존재하는 신호만 사용" (no candidate is
// penalized for a signal it never had a chance to have, e.g. a post with no
// image), and no new tunable weight is introduced (an unweighted average of
// however many signals exist isn't a parameter to tune).
function combineRankings(text: VectorSearchResult[], image: VectorSearchResult[]): RankedCandidate[] {
  const scoresById = new Map<number, number[]>();
  for (const r of text) scoresById.set(r.id, [...(scoresById.get(r.id) ?? []), r.score]);
  for (const r of image) scoresById.set(r.id, [...(scoresById.get(r.id) ?? []), r.score]);

  return [...scoresById.entries()]
    .map(([id, scores]) => ({ id, score: scores.reduce((sum, s) => sum + s, 0) / scores.length }))
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

async function computeRanking(sourceType: PostType, sourceId: number): Promise<RankedCandidate[]> {
  const [textRanked, imageRanked] = await Promise.all([
    findSimilarPosts(sourceType, sourceId, TOP_K).catch((error) => {
      // Expected, not exceptional -- see findSimilarPosts()'s own comment:
      // a post can legitimately have no text embedding yet. Any other
      // error is a real failure and should still surface.
      if (error instanceof EmbeddingNotAvailableError) return [];
      throw error;
    }),
    // findSimilarPostsByImage() never throws for a missing source
    // imageEmbedding (most posts have no image) -- it just returns [].
    findSimilarPostsByImage(sourceType, sourceId, TOP_K),
  ]);

  return combineRankings(textRanked, imageRanked).slice(0, TOP_K);
}

// LostPost -> FoundPost recommendations, FoundPost -> LostPost -- same
// cross-board convention every AI-ranking feature in this app already uses
// (Match candidates, image similarity, both search modes). The source post
// itself is never a candidate (only the opposite board is ever queried),
// and a candidate that's since been deleted or made inaccessible is simply
// absent from the enrichment step below, never returned.
export async function findPostRecommendations(sourceType: PostType, sourceId: number): Promise<PostDTO[]> {
  const ranking = (await readCachedRanking(sourceType, sourceId)) ?? (await computeAndCache(sourceType, sourceId));
  if (ranking.length === 0) return [];

  const targetType: PostType = sourceType === "lost" ? "found" : "lost";
  const ids = ranking.map((r) => r.id);
  const rows =
    targetType === "lost"
      ? await prisma.lostPost.findMany({ where: { id: { in: ids } }, include: { user: { select: AUTHOR_SELECT } } })
      : await prisma.foundPost.findMany({ where: { id: { in: ids } }, include: { user: { select: AUTHOR_SELECT } } });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const scoreById = new Map(ranking.map((r) => [r.id, r.score]));

  // Re-order to match the ranking (findMany({id:{in}}) doesn't preserve
  // it); a missing row here means the candidate was deleted since the
  // ranking was computed/cached -- dropped, not an error.
  return ids
    .map((id) => rowById.get(id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .map((row) => {
      const dto =
        targetType === "lost"
          ? toLostPostDTO(row as Parameters<typeof toLostPostDTO>[0])
          : toFoundPostDTO(row as Parameters<typeof toFoundPostDTO>[0]);
      return { ...dto, score: scoreById.get(row.id) };
    });
}

async function computeAndCache(sourceType: PostType, sourceId: number): Promise<RankedCandidate[]> {
  const ranking = await computeRanking(sourceType, sourceId);
  await writeCachedRanking(sourceType, sourceId, ranking);
  return ranking;
}
