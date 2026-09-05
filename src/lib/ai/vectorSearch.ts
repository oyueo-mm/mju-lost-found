import { prisma } from "@/lib/db/prisma";
import { normalizeScore } from "./matching";
import type { PostType } from "@/lib/posts/schema";

// Real pgvector search -- replaces the brute-force "fetch up to 50 most
// recent candidates, re-embed every one of them in Node on every request,
// sort in JS" approach (the old src/lib/ai/matching.ts::rankCandidates()
// path, still used by src/lib/match/candidates.ts's CANDIDATE_POOL_SIZE=50
// heuristic prior to this module). Every LostPost/FoundPost with a stored
// embedding is a real candidate now, not just the most recent 50 -- see
// docs/AI_MATCHING_ARCHITECTURE.md section 7 for why that pool cap was
// silently dropping real matches as the tables grew, not just being slow.
//
// Table names are never interpolated from caller input: sourceType is the
// internal "lost" | "found" union (not raw user input), and each branch
// below is one fully-literal SQL string. Only the post id and topK are
// ever bound as query parameters (Prisma's tagged-template $queryRaw
// parameterizes them -- this is not string concatenation).

export class EmbeddingNotAvailableError extends Error {
  constructor(sourceType: PostType, sourcePostId: number) {
    super(`No embedding stored for ${sourceType} post ${sourcePostId}`);
    this.name = "EmbeddingNotAvailableError";
  }
}

export type VectorSearchResult = { id: number; score: number };

// pgvector's `<=>` is cosine *distance* (1 - cosine_similarity, range
// roughly [0, 2] since our vectors are L2-normalized -- see
// TransformersEmbeddingProvider's `normalize: true`). `1 - distance`
// recovers the raw cosine similarity, which is then passed through the
// exact same normalizeScore() the old brute-force path uses (matching.ts)
// -- so Match.score keeps meaning the same 0-1 scale regardless of which
// ranking path produced it (manual matches still default to 1.0).
export async function findSimilarPosts(
  sourceType: PostType,
  sourcePostId: number,
  topK: number,
): Promise<VectorSearchResult[]> {
  const rows =
    sourceType === "lost"
      ? await prisma.$queryRaw<{ id: number; similarity: number }[]>`
          WITH source AS (
            SELECT embedding FROM "LostPost" WHERE id = ${sourcePostId}
          )
          SELECT fp.id AS id, 1 - (fp.embedding <=> source.embedding) AS similarity
          FROM "FoundPost" fp, source
          WHERE fp.embedding IS NOT NULL AND source.embedding IS NOT NULL
          ORDER BY fp.embedding <=> source.embedding
          LIMIT ${topK}
        `
      : await prisma.$queryRaw<{ id: number; similarity: number }[]>`
          WITH source AS (
            SELECT embedding FROM "FoundPost" WHERE id = ${sourcePostId}
          )
          SELECT lp.id AS id, 1 - (lp.embedding <=> source.embedding) AS similarity
          FROM "LostPost" lp, source
          WHERE lp.embedding IS NOT NULL AND source.embedding IS NOT NULL
          ORDER BY lp.embedding <=> source.embedding
          LIMIT ${topK}
        `;

  // The CTE's cross join (`FROM candidates, source`) silently produces
  // zero rows both when the source post has no embedding yet *and* when
  // it has one but genuinely no candidates exist -- those two cases need
  // different handling by the caller (ai_unavailable vs. a plain empty
  // result, see src/lib/match/candidates.ts), so they're disambiguated
  // with one extra, cheap primary-key lookup rather than guessing from
  // row count.
  if (rows.length === 0 && !(await hasEmbedding(sourceType, sourcePostId))) {
    throw new EmbeddingNotAvailableError(sourceType, sourcePostId);
  }

  return rows.map((row) => ({ id: row.id, score: normalizeScore(row.similarity) }));
}

async function hasEmbedding(type: PostType, id: number): Promise<boolean> {
  const rows =
    type === "lost"
      ? await prisma.$queryRaw<{ present: boolean }[]>`
          SELECT (embedding IS NOT NULL) AS present FROM "LostPost" WHERE id = ${id}
        `
      : await prisma.$queryRaw<{ present: boolean }[]>`
          SELECT (embedding IS NOT NULL) AS present FROM "FoundPost" WHERE id = ${id}
        `;
  return rows[0]?.present ?? false;
}

// Writes/clears a post's embedding. Only ever called from
// src/lib/posts/service.ts, right after the corresponding create/update
// already committed via the normal Prisma call -- see that file's
// comments for why embedding generation is a separate, independently-
// failable step rather than part of the same transaction (Option B,
// documented in docs/AI_MATCHING_ARCHITECTURE.md).
export async function saveEmbedding(
  type: PostType,
  id: number,
  vector: number[] | null,
): Promise<void> {
  const literal = vector ? `[${vector.join(",")}]` : null;
  if (type === "lost") {
    await prisma.$executeRaw`UPDATE "LostPost" SET embedding = ${literal}::vector WHERE id = ${id}`;
  } else {
    await prisma.$executeRaw`UPDATE "FoundPost" SET embedding = ${literal}::vector WHERE id = ${id}`;
  }
}
