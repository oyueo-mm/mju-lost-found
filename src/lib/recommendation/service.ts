import { prisma } from "@/lib/db/prisma";
import {
  EmbeddingNotAvailableError,
  findCandidateCosines,
  findSimilarPosts,
  findSimilarPostsByImage,
} from "@/lib/ai/vectorSearch";
import { AI_SIMILARITY_SCALE_ID, candidatePool, rankByAiSimilarity, type RankedCandidate } from "@/lib/ai/rankFusion";
import { AUTHOR_SELECT, PUBLIC_POST_WHERE, POST_ORGANIZATION_SELECT, toFoundPostDTO, toLostPostDTO, type PostDTO } from "@/lib/posts/service";
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

// Only {id, score} is cached, never the hydrated post row -- so a cached
// ranking can never show a stale title/status, or a since-deleted post: the
// actual LostPost/FoundPost rows are always re-fetched fresh on every read
// below, and a since-deleted id simply drops out of the `findMany` result.
// What IS cached (and can go stale) is the *ranking itself*, invalidated
// the same way the old Match-candidate cache was -- see
// invalidateRecommendationCache()'s callers.
//
// AI 유사도 척도 통일 Phase: a row's `candidates` JSON is now
// `{ scale, ranking }`, where `scale` is the AI_SIMILARITY_SCALE_ID the
// scores were computed on. Anything else is a cache miss (recomputed and
// overwritten on the next read), never an error. That covers the pre-Phase
// J-2 Match-candidate shape ({postId, type, title, ...}), the Phase J-2..
// O-4 bare `[{id, score}]` arrays whose scores are *relative* (in-pool
// min-max, top always 1.000) and must never be shown as an AI 유사도
// again, and any future baseline change (which changes the scale id). So
// the old relative-score rows are invalidated lazily and safely -- no bulk
// delete or migration, and still correct if an old instance writes an
// old-shape row during a rolling deploy.
type CachedRanking = { scale: string; ranking: RankedCandidate[] };

function isCurrentScaleRanking(value: unknown): value is CachedRanking {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { scale, ranking } = value as Partial<CachedRanking>;
  return (
    scale === AI_SIMILARITY_SCALE_ID &&
    Array.isArray(ranking) &&
    ranking.every((v) => typeof v === "object" && v !== null && typeof v.id === "number" && typeof v.score === "number")
  );
}

async function readCachedRanking(sourceType: PostType, sourcePostId: number): Promise<RankedCandidate[] | null> {
  const cached = await prisma.matchCandidateCache.findUnique({
    where: { sourceType_sourcePostId: { sourceType, sourcePostId } },
  });
  if (!cached) return null;
  return isCurrentScaleRanking(cached.candidates) ? cached.candidates.ranking : null;
}

async function writeCachedRanking(
  sourceType: PostType,
  sourcePostId: number,
  ranking: RankedCandidate[],
): Promise<void> {
  const candidates: CachedRanking = { scale: AI_SIMILARITY_SCALE_ID, ranking };
  await prisma.matchCandidateCache.upsert({
    where: { sourceType_sourcePostId: { sourceType, sourcePostId } },
    create: { sourceType, sourcePostId, candidates },
    update: { candidates, computedAt: new Date() },
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

// AI 유사도 척도 통일 Phase ("D3-pool"): the candidate pool is unchanged --
// the text top-K ∪ the image top-K the two pgvector searches return -- but
// the pool is now ordered, and each candidate's displayed score set, by
// rankFusion.ts's absolute AI 유사도 (D3) instead of the old in-pool
// min-max average, whose top candidate always read 1.000. Both signals are
// looked up for every pooled candidate, so a candidate that only made the
// text top-K still has its image similarity counted when both posts have
// an image. No threshold here: this is the full top-K ranking (what gets
// cached); applyRecommendationMinimum() below decides what is shown.
//
// Exported without the cache write so the offline benchmark
// (scripts/ai-eval-seed/evaluate.ts) can measure this exact ranking
// without writing to MatchCandidateCache.
export async function computeRecommendationRanking(sourceType: PostType, sourceId: number): Promise<RankedCandidate[]> {
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

  const pool = candidatePool(textRanked, imageRanked);
  if (pool.length === 0) return [];
  return rankByAiSimilarity(await findCandidateCosines(sourceType, sourceId, pool)).slice(0, TOP_K);
}

// 추천 최소 AI 유사도 Phase: a candidate below this D3 score is not shown as
// a recommendation, and a source whose candidates are all below it gets
// the ordinary "추천 없음" empty state (SimilarPostsSection's
// recommend.empty.*). Measured on the 249-post Preview benchmark
// (docs/ai-eval-seed/baseline-d3-249-2026-09-29.md): 0.35 hid the whole list
// for 52% of the no-match posts while dropping 2.8% of correct answers
// that were in the top K. Recommendation-only -- AI 검색's scores sit on a
// lower range (query vs. post cosines run lower than post vs. post), so
// this value must not be reused there.
//
// Applied when reading, not when caching: MatchCandidateCache keeps the
// full D3 ranking, so changing this value needs no cache invalidation.
export const RECOMMENDATION_MIN_AI_SIMILARITY = 0.35;

export function applyRecommendationMinimum(ranking: RankedCandidate[]): RankedCandidate[] {
  return ranking.filter((candidate) => candidate.score >= RECOMMENDATION_MIN_AI_SIMILARITY);
}

// LostPost -> FoundPost recommendations, FoundPost -> LostPost -- same
// cross-board convention every AI-ranking feature in this app already uses
// (Match candidates, image similarity, both search modes). The source post
// itself is never a candidate (only the opposite board is ever queried),
// and a candidate that's since been deleted or made inaccessible is simply
// absent from the enrichment step below, never returned.
export async function findPostRecommendations(sourceType: PostType, sourceId: number): Promise<PostDTO[]> {
  const ranking = applyRecommendationMinimum(
    (await readCachedRanking(sourceType, sourceId)) ?? (await computeAndCache(sourceType, sourceId)),
  );
  if (ranking.length === 0) return [];

  const targetType: PostType = sourceType === "lost" ? "found" : "lost";
  const ids = ranking.map((r) => r.id);
  const rows =
    targetType === "lost"
      ? await prisma.lostPost.findMany({ where: { id: { in: ids }, ...PUBLIC_POST_WHERE }, include: { user: { select: AUTHOR_SELECT }, organization: { select: POST_ORGANIZATION_SELECT } } })
      : await prisma.foundPost.findMany({ where: { id: { in: ids }, ...PUBLIC_POST_WHERE }, include: { user: { select: AUTHOR_SELECT }, organization: { select: POST_ORGANIZATION_SELECT } } });
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
  const ranking = await computeRecommendationRanking(sourceType, sourceId);
  await writeCachedRanking(sourceType, sourceId, ranking);
  return ranking;
}
