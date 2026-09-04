import { getEmbeddingProvider } from "./embedding";
import type { PostType } from "@/lib/posts/schema";

// Cosine similarity between two vectors, in [-1, 1]. Returns 0 for a zero
// vector (undefined direction) instead of dividing by zero -- same guard
// as the legacy ai/matching.py::cosine_similarity().
export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Maps cosine similarity's natural [-1, 1] range onto [0, 1], so it reads
// like the same 0-1 confidence scale Match.score already uses (Phase 7's
// manual match default is 1.0).
export function normalizeScore(cosine: number): number {
  return Math.min(1, Math.max(0, (cosine + 1) / 2));
}

export type CandidatePost = {
  id: number;
  type: PostType;
  text: string;
  createdAt: Date;
};

export type ScoredCandidate = {
  id: number;
  type: PostType;
  score: number;
};

export const DEFAULT_TOP_K = 5;

// Never touches the DB itself, same boundary as the legacy
// ai/matching.py::rank_similar_posts() -- callers (src/lib/match/
// candidates.ts) supply the target text and an already-fetched, already-
// bounded candidate pool. Ranks by score desc, then createdAt desc, then
// id desc, so ties resolve the same way on every call rather than
// depending on incoming array order.
export async function rankCandidates(
  targetText: string,
  candidates: CandidatePost[],
  topK: number = DEFAULT_TOP_K,
): Promise<ScoredCandidate[]> {
  if (candidates.length === 0) return [];

  const provider = getEmbeddingProvider();
  const targetVector = await provider.embed(targetText);

  const scored = await Promise.all(
    candidates.map(async (candidate) => ({
      id: candidate.id,
      type: candidate.type,
      score: normalizeScore(cosineSimilarity(targetVector, await provider.embed(candidate.text))),
      createdAt: candidate.createdAt,
    })),
  );

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    return b.id - a.id;
  });

  return scored.slice(0, topK).map(({ id, type, score }) => ({ id, type, score }));
}
