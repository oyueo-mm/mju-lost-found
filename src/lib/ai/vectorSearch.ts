import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
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

export type SemanticSearchFilters = {
  category?: string;
  // Phase 31: exact match, same as category -- see posts/service.ts's
  // buildSearchWhere() comment on the same replacement of the old
  // free-text `location` filter with the fixed campus enum.
  campus?: string;
  // Korean status string (e.g. "찾는 중") -- already validated against the
  // right board's enum by listQuerySchema's superRefine before it ever
  // reaches here (see posts/schema.ts), same contract as
  // posts/service.ts's buildSearchWhere() uses for the keyword-search path.
  status?: string;
  dateFrom?: Date;
  dateTo?: Date;
};

// Phase 12: free-text semantic search. Unlike findSimilarPosts() above,
// there is no source *post* here -- a search query is never saved to the
// DB -- so the caller (posts/service.ts) computes the query embedding
// itself via getEmbeddingProvider().embed(query) and passes the resulting
// vector straight in. This function's only job is turning that vector
// (+ optional DB filters) into one parameterized pgvector query against a
// single literal table; it never computes an embedding itself, keeping
// the embedding-provider and vector-search responsibilities separate (see
// docs/AI_SEMANTIC_SEARCH_DESIGN.md section 3).
//
// Filters are applied in the SQL WHERE clause itself -- not as a
// post-hoc JS filter over the top-K similarity results -- so a filtered
// search still returns the K *best-matching-and-filter-satisfying* posts,
// rather than "the K best matches overall, some of which then get
// dropped" (which could silently return fewer than K, or none, even when
// better filtered candidates exist further down the similarity ranking).
export async function findPostsBySemanticQuery(
  targetType: PostType,
  queryVector: number[],
  topK: number,
  filters: SemanticSearchFilters = {},
): Promise<VectorSearchResult[]> {
  const vectorLiteral = `[${queryVector.join(",")}]`;
  // table/statusType are the only Prisma.raw() uses here, and both are
  // always one of two fully-literal strings chosen by targetType (the
  // internal "lost" | "found" union, never raw client input) -- the same
  // literal-table-name convention findSimilarPosts() above already uses.
  // Postgres's actual enum type stores the Korean labels themselves as
  // its values (see the init migration's `CREATE TYPE "LostPostStatus" AS
  // ENUM ('찾는 중', '찾음')`), so filters.status casts directly with no
  // separate ASCII-identifier mapping needed.
  const table = targetType === "lost" ? Prisma.raw(`"LostPost"`) : Prisma.raw(`"FoundPost"`);
  const statusType = targetType === "lost" ? Prisma.raw(`"LostPostStatus"`) : Prisma.raw(`"FoundPostStatus"`);

  // Every condition is a parameterized Prisma.sql fragment -- never
  // string-concatenated filter input -- joined with " AND " while each
  // fragment keeps its own bound parameter.
  const conditions: InstanceType<typeof Prisma.Sql>[] = [Prisma.sql`embedding IS NOT NULL`];
  if (filters.category) conditions.push(Prisma.sql`category = ${filters.category}`);
  if (filters.campus) conditions.push(Prisma.sql`campus = ${filters.campus}`);
  if (filters.status) conditions.push(Prisma.sql`status = ${filters.status}::${statusType}`);
  if (filters.dateFrom) conditions.push(Prisma.sql`created_at >= ${filters.dateFrom}`);
  if (filters.dateTo) conditions.push(Prisma.sql`created_at <= ${filters.dateTo}`);

  const rows = await prisma.$queryRaw<{ id: number; similarity: number }[]>(Prisma.sql`
    SELECT id, 1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
    FROM ${table}
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY embedding <=> ${vectorLiteral}::vector, id
    LIMIT ${topK}
  `);

  return rows.map((row) => ({ id: row.id, score: normalizeScore(row.similarity) }));
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

// ---------- Image similarity (Phase 15-2) ----------

// Same shape/reasoning as saveEmbedding() above, writing the separate
// "imageEmbedding" column instead -- only ever called from
// src/lib/images/service.ts (setPostImage/clearPostImage), never from
// posts/service.ts, since attaching/replacing/removing a post's image is
// exclusively that module's job (see /api/posts/[id]/image).
export async function saveImageEmbedding(
  type: PostType,
  id: number,
  vector: number[] | null,
): Promise<void> {
  const literal = vector ? `[${vector.join(",")}]` : null;
  if (type === "lost") {
    await prisma.$executeRaw`UPDATE "LostPost" SET "imageEmbedding" = ${literal}::vector WHERE id = ${id}`;
  } else {
    await prisma.$executeRaw`UPDATE "FoundPost" SET "imageEmbedding" = ${literal}::vector WHERE id = ${id}`;
  }
}

// Cross-board only: a Lost post's image is compared against FoundPost's
// imageEmbedding column and vice versa, never against its own board (see
// docs/IMAGE_EMBEDDING_POC.md section 11 / this phase's spec -- an
// AirPods lost by one student should surface AirPods someone *found*, not
// other lost-AirPods posts). Mirrors findSimilarPosts()'s CTE shape
// exactly, with imageEmbedding in place of embedding -- but unlike that
// function, a missing *source* imageEmbedding is not disambiguated from
// "no candidates" with a thrown error: the caller (the post detail page)
// already knows whether this post has an image at all before ever calling
// this, and simply doesn't render the "이 사진과 비슷한 게시물" section
// when the result is empty (see src/app/(main)/post/[id]/page.tsx) --
// there is no separate "AI 매칭 사용 불가" UI state to feed here the way
// src/lib/match/candidates.ts needs EmbeddingNotAvailableError for.
export async function findSimilarPostsByImage(
  sourceType: PostType,
  sourcePostId: number,
  topK: number,
): Promise<VectorSearchResult[]> {
  const rows =
    sourceType === "lost"
      ? await prisma.$queryRaw<{ id: number; similarity: number }[]>`
          WITH source AS (
            SELECT "imageEmbedding" FROM "LostPost" WHERE id = ${sourcePostId}
          )
          SELECT fp.id AS id, 1 - (fp."imageEmbedding" <=> source."imageEmbedding") AS similarity
          FROM "FoundPost" fp, source
          WHERE fp."imageEmbedding" IS NOT NULL AND source."imageEmbedding" IS NOT NULL
          ORDER BY fp."imageEmbedding" <=> source."imageEmbedding"
          LIMIT ${topK}
        `
      : await prisma.$queryRaw<{ id: number; similarity: number }[]>`
          WITH source AS (
            SELECT "imageEmbedding" FROM "FoundPost" WHERE id = ${sourcePostId}
          )
          SELECT lp.id AS id, 1 - (lp."imageEmbedding" <=> source."imageEmbedding") AS similarity
          FROM "LostPost" lp, source
          WHERE lp."imageEmbedding" IS NOT NULL AND source."imageEmbedding" IS NOT NULL
          ORDER BY lp."imageEmbedding" <=> source."imageEmbedding"
          LIMIT ${topK}
        `;

  return rows.map((row) => ({ id: row.id, score: normalizeScore(row.similarity) }));
}

// Phase 32: image *search* -- the query is an arbitrary uploaded photo's
// embedding (never a stored post's own imageEmbedding, unlike
// findSimilarPostsByImage above), and the caller picks which board to
// search (targetType), the same "user picks lost or found" contract
// findPostsBySemanticQuery already uses for text search. Mirrors that
// function's shape exactly, `imageEmbedding` in place of `embedding` --
// same reused filter set (category/campus/status/dateFrom/dateTo), same
// parameterized Prisma.sql conditions, never string-concatenated.
export async function findPostsByImageQuery(
  targetType: PostType,
  queryVector: number[],
  topK: number,
  filters: SemanticSearchFilters = {},
): Promise<VectorSearchResult[]> {
  const vectorLiteral = `[${queryVector.join(",")}]`;
  const table = targetType === "lost" ? Prisma.raw(`"LostPost"`) : Prisma.raw(`"FoundPost"`);
  const statusType = targetType === "lost" ? Prisma.raw(`"LostPostStatus"`) : Prisma.raw(`"FoundPostStatus"`);

  const conditions: InstanceType<typeof Prisma.Sql>[] = [Prisma.sql`"imageEmbedding" IS NOT NULL`];
  if (filters.category) conditions.push(Prisma.sql`category = ${filters.category}`);
  if (filters.campus) conditions.push(Prisma.sql`campus = ${filters.campus}`);
  if (filters.status) conditions.push(Prisma.sql`status = ${filters.status}::${statusType}`);
  if (filters.dateFrom) conditions.push(Prisma.sql`created_at >= ${filters.dateFrom}`);
  if (filters.dateTo) conditions.push(Prisma.sql`created_at <= ${filters.dateTo}`);

  const rows = await prisma.$queryRaw<{ id: number; similarity: number }[]>(Prisma.sql`
    SELECT id, 1 - ("imageEmbedding" <=> ${vectorLiteral}::vector) AS similarity
    FROM ${table}
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY "imageEmbedding" <=> ${vectorLiteral}::vector, id
    LIMIT ${topK}
  `);

  return rows.map((row) => ({ id: row.id, score: normalizeScore(row.similarity) }));
}
