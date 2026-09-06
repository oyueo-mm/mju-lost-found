-- Phase 28-3: chat image messages.
--
-- Hand-written (not `prisma migrate diff`'s raw output), same reason as
-- every migration since Phase 23: the live database has an
-- `imageEmbeddingDino` column + HNSW indexes on LostPost/FoundPost from
-- earlier, never-committed Phase 15-5 work that isn't part of
-- prisma/schema.prisma in this branch. A blind diff-to-schema migration
-- would DROP those -- this migration is purely additive (one nullable
-- column on Message), and does not touch anything else.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "image_url" TEXT;
