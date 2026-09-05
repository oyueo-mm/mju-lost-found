-- Phase 15-2: image-similarity embeddings for LostPost/FoundPost.
--
-- A deliberately separate column from the existing `embedding` (text)
-- column added in 20260905102654_add_post_embeddings -- image and text
-- embeddings come from different models (Xenova/siglip-base-patch16-224
-- vs jhgan/ko-sroberta-multitask) and are never compared to each other, so
-- they are never merged into one vector or one column. The `vector`
-- extension is already enabled (see that earlier migration); no need to
-- CREATE EXTENSION again here.
--
-- Nullable, added to existing tables -- no existing row loses data or
-- fails to insert/update just because it has no image embedding yet
-- (including every post that predates this column, and every post with no
-- image at all). Prisma has no native `vector` type, so this column is
-- declared in schema.prisma as `Unsupported("vector(768)")` and is only
-- ever read/written via $queryRaw/$executeRaw (see
-- src/lib/ai/vectorSearch.ts's saveImageEmbedding/findSimilarPostsByImage)
-- -- Prisma Client itself never sees it in select/include.
ALTER TABLE "LostPost" ADD COLUMN "imageEmbedding" vector(768);
ALTER TABLE "FoundPost" ADD COLUMN "imageEmbedding" vector(768);

-- HNSW over cosine distance, matching the existing text-embedding indexes
-- exactly (see docs/AI_MATCHING_ARCHITECTURE.md section 5 for why HNSW
-- over IVFFlat). Separate index per column/table -- image similarity
-- search never touches the text `embedding` index or vice versa.
CREATE INDEX IF NOT EXISTS "idx_lostpost_image_embedding_hnsw"
  ON "LostPost" USING hnsw ("imageEmbedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "idx_foundpost_image_embedding_hnsw"
  ON "FoundPost" USING hnsw ("imageEmbedding" vector_cosine_ops);
