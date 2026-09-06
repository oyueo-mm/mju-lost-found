-- Phase 31: required campus selection on LostPost/FoundPost.
--
-- Hand-written (not `prisma migrate diff`'s raw output), same reason as
-- every migration since Phase 23: the live database has an
-- `imageEmbeddingDino` column + HNSW indexes on LostPost/FoundPost from
-- earlier, never-committed Phase 15-5 work that isn't part of
-- prisma/schema.prisma in this branch. A blind diff-to-schema migration
-- would DROP those -- this migration is purely additive (one NOT NULL
-- column, defaulted, on each of LostPost/FoundPost), and does not touch
-- anything else. The DEFAULT applies to existing rows too, so every
-- pre-existing post is backfilled to "인문캠퍼스" rather than left NULL.

-- AlterTable
ALTER TABLE "LostPost" ADD COLUMN "campus" TEXT NOT NULL DEFAULT '인문캠퍼스';

-- AlterTable
ALTER TABLE "FoundPost" ADD COLUMN "campus" TEXT NOT NULL DEFAULT '인문캠퍼스';
