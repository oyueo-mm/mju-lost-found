import { prisma } from "@/lib/db/prisma";
import { buildEmbeddingText } from "@/lib/ai/embedding";
import { rankCandidates, type ScoredCandidate } from "@/lib/ai/matching";
import type { PostType } from "@/lib/posts/schema";

// Bounds how many rows of the *opposite* board are ever fetched/embedded
// for one candidate request -- proportional to this constant, never to
// total table size. This is a candidate-pool heuristic (most recent N),
// not a semantic filter: it never excludes a post based on category/
// location, only on recency, so a real match that happens to use
// different wording still gets embedded and scored.
const CANDIDATE_POOL_SIZE = 50;

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

  const candidateType: PostType = sourceType === "lost" ? "found" : "lost";
  const pool =
    candidateType === "found"
      ? await prisma.foundPost.findMany({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: CANDIDATE_POOL_SIZE,
        })
      : await prisma.lostPost.findMany({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: CANDIDATE_POOL_SIZE,
        });

  if (pool.length === 0) return { kind: "ok", data: [] };

  let ranked: ScoredCandidate[];
  try {
    ranked = await rankCandidates(
      buildEmbeddingText(source),
      pool.map((post) => ({
        id: post.id,
        type: candidateType,
        text: buildEmbeddingText(post),
        createdAt: post.createdAt,
      })),
    );
  } catch (error) {
    // The current lexical provider (see src/lib/ai/embedding.ts) is a
    // pure in-process computation with no real failure mode, but a future
    // hosted-API provider could throw for any number of reasons (network,
    // rate limit, timeout) -- this is the seam that turns any of those
    // into a graceful "AI unavailable" result instead of a raw 500.
    console.error("AI candidate ranking failed:", error);
    return { kind: "ai_unavailable" };
  }

  const postsById = new Map(pool.map((post) => [post.id, post]));
  const data = ranked.flatMap((r): EnrichedCandidate[] => {
    const post = postsById.get(r.id);
    if (!post) return [];
    return [
      {
        postId: r.id,
        type: r.type,
        score: r.score,
        title: post.title,
        category: post.category,
        location: post.location,
        imageUrl: post.imageUrl,
      },
    ];
  });

  return { kind: "ok", data };
}
