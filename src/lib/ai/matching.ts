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
// like the same 0-1 confidence scale Match.score already uses (a manual
// match's default is 1.0). Used both here (nothing left in this file
// calls it directly anymore) and by src/lib/ai/vectorSearch.ts, so that
// pgvector-backed scores stay on the exact same scale as before --
// swapping brute-force ranking for a DB-side similarity search didn't
// change what a "0.8" means anywhere else in the app (Match.score,
// notifications, etc.).
export function normalizeScore(cosine: number): number {
  return Math.min(1, Math.max(0, (cosine + 1) / 2));
}

// Phase 6 note: this file used to also export rankCandidates() -- a
// brute-force ranker that re-embedded every candidate in Node on every
// request (see src/lib/match/candidates.ts's old CANDIDATE_POOL_SIZE=50
// heuristic, needed only to keep that brute-force cost bounded). It's
// been replaced by src/lib/ai/vectorSearch.ts::findSimilarPosts(), which
// does the same ranking as a real pgvector similarity search instead --
// see docs/AI_MATCHING_ARCHITECTURE.md sections 7 and 14 for why.
