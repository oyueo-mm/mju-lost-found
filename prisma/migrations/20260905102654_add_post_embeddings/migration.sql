-- Phase 6: real semantic-search embeddings for LostPost/FoundPost.
--
-- pgvector was already enabled into the `extensions` schema during Phase
-- 5's PoC (Supabase's own convention, keeps extension objects out of
-- `public` so pg_dump/migrations don't collide with them) -- `IF NOT
-- EXISTS` here just makes this migration replayable against a fresh
-- Supabase project too, where it wouldn't exist yet.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Nullable, added to existing tables -- no existing row (including the
-- one real post already in this database at the time of writing) loses
-- data or fails to insert/update just because it has no embedding yet.
-- Prisma has no native `vector` type (tracked upstream:
-- https://github.com/prisma/prisma/issues/26546), so this column is
-- declared in schema.prisma as `Unsupported("vector(768)")` and is only
-- ever read/written via $queryRaw/$executeRaw (see src/lib/ai/vectorSearch.ts)
-- -- Prisma Client itself never sees it in select/include.
ALTER TABLE "LostPost" ADD COLUMN "embedding" vector(768);
ALTER TABLE "FoundPost" ADD COLUMN "embedding" vector(768);

-- HNSW over cosine distance, matching Phase 5's PoC exactly (no IVFFlat
-- "lists" tuning needed, and HNSW degrades gracefully as the table grows
-- rather than needing a rebuild -- see docs/AI_MATCHING_ARCHITECTURE.md
-- section 5). Postgres may still choose a sequential scan over this index
-- while the tables are small (a handful of rows) -- that's the query
-- planner correctly judging the index not worth it yet, not a sign the
-- index is broken; see the same doc's section 7.
CREATE INDEX IF NOT EXISTS "idx_lostpost_embedding_hnsw"
  ON "LostPost" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "idx_foundpost_embedding_hnsw"
  ON "FoundPost" USING hnsw ("embedding" vector_cosine_ops);
