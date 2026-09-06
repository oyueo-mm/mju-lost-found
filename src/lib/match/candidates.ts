import { prisma } from "@/lib/db/prisma";
import { EmbeddingNotAvailableError, findSimilarPosts } from "@/lib/ai/vectorSearch";
import type { PostType } from "@/lib/posts/schema";

// How many ranked candidates a single "find matches for this post" request
// returns -- matches the legacy ai/matching.py's DEFAULT_TOP_K (3 there;
// this app's earlier phase already chose 5 for this UI and that choice is
// kept, not revisited by this phase).
const TOP_K = 5;

export type EnrichedCandidate = {
  postId: number;
  type: PostType;
  score: number;
  title: string;
  category: string;
  location: string;
  imageUrl: string | null;
};

export type MatchCandidateResult =
  | { kind: "ok"; data: EnrichedCandidate[] }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "ai_unavailable" };

// Phase 23: raw AI candidates were never persisted before this phase --
// findMatchCandidates() recomputed a real pgvector search on every single
// call, including every automatic page-load (see MatchPanel's old
// useEffect). Now that a button click is the only caller, a *cache*
// (never Match itself -- see schema.prisma's MatchCandidateCache comment
// for why that would be the wrong place) makes a second click on an
// already-computed post free. Invalidated by src/lib/posts/aiService.ts
// whenever this source post's own embedding is recomputed; a new post
// appearing on the opposite board after this was cached does not
// invalidate it -- an accepted staleness trade-off (see this phase's
// report), not something this cache tries to solve.
async function readCachedCandidates(sourceType: PostType, sourcePostId: number): Promise<EnrichedCandidate[] | null> {
  const cached = await prisma.matchCandidateCache.findUnique({
    where: { sourceType_sourcePostId: { sourceType, sourcePostId } },
  });
  return cached ? (cached.candidates as unknown as EnrichedCandidate[]) : null;
}

async function writeCachedCandidates(
  sourceType: PostType,
  sourcePostId: number,
  candidates: EnrichedCandidate[],
): Promise<void> {
  await prisma.matchCandidateCache.upsert({
    where: { sourceType_sourcePostId: { sourceType, sourcePostId } },
    create: { sourceType, sourcePostId, candidates: candidates as unknown as object },
    update: { candidates: candidates as unknown as object, computedAt: new Date() },
  });
}

// Requires the requester to own the source post -- same visibility rule
// as listMatchesForPost() in src/lib/match/service.ts (a match/candidate
// pairing isn't public the way the posts themselves are).
export async function findMatchCandidates(
  sourceType: PostType,
  sourceId: number,
  requesterId: number,
): Promise<MatchCandidateResult> {
  const source =
    sourceType === "lost"
      ? await prisma.lostPost.findUnique({ where: { id: sourceId } })
      : await prisma.foundPost.findUnique({ where: { id: sourceId } });
  if (!source) return { kind: "not_found" };
  if (source.userId !== requesterId) return { kind: "forbidden" };

  const cached = await readCachedCandidates(sourceType, sourceId);
  if (cached) return { kind: "ok", data: cached };

  const candidateType: PostType = sourceType === "lost" ? "found" : "lost";

  let ranked;
  try {
    // A real pgvector similarity search over *every* post on the opposite
    // board that has a stored embedding -- not a "most recent N" pool.
    // See src/lib/ai/vectorSearch.ts and docs/AI_MATCHING_ARCHITECTURE.md
    // section 7 for why the old brute-force approach's hardcoded pool size
    // was silently dropping real matches, not just being slow.
    ranked = await findSimilarPosts(sourceType, sourceId, TOP_K);
  } catch (error) {
    if (error instanceof EmbeddingNotAvailableError) {
      // Expected, not exceptional: a post can legitimately have no
      // embedding yet (generation is best-effort and never blocks post
      // creation -- see src/lib/posts/service.ts's Option B policy,
      // documented in docs/AI_MATCHING_ARCHITECTURE.md). Same
      // "ai_unavailable" result as a real failure below, but not logged
      // as one -- an admin backfill (or the next edit) resolves this on
      // its own.
    } else {
      console.error("AI candidate ranking failed:", error);
    }
    return { kind: "ai_unavailable" };
  }

  if (ranked.length === 0) {
    await writeCachedCandidates(sourceType, sourceId, []);
    return { kind: "ok", data: [] };
  }

  const ids = ranked.map((r) => r.id);
  const pool =
    candidateType === "found"
      ? await prisma.foundPost.findMany({ where: { id: { in: ids } } })
      : await prisma.lostPost.findMany({ where: { id: { in: ids } } });
  const postsById = new Map(pool.map((post) => [post.id, post]));

  const data = ranked.flatMap((r): EnrichedCandidate[] => {
    const post = postsById.get(r.id);
    if (!post) return [];
    return [
      {
        postId: r.id,
        type: candidateType,
        score: r.score,
        title: post.title,
        category: post.category,
        location: post.location,
        imageUrl: post.imageUrl,
      },
    ];
  });

  await writeCachedCandidates(sourceType, sourceId, data);
  return { kind: "ok", data };
}
