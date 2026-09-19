-- Phase 16-2 prototype: a THIRD, independent image-embedding column for
-- LostPost/FoundPost using Xenova/dinov2-small (384-dim), evaluated as a
-- <60MiB alternative to the existing SigLIP-based `imageEmbedding` column
-- (768-dim, added in 20260906021423_add_post_image_embeddings) after
-- Phase 15's real Vercel deployments repeatedly hit the Hobby plan's
-- 12-Serverless-Function cap with SigLIP's ~94.88MiB runtime payload (see
-- Phase 15-4 through 15-9's real, evidence-based investigation).
--
-- Deliberately additive, not a migration of `imageEmbedding` -- the old
-- column is neither dropped nor renamed here. SigLIP and DINOv2 are
-- different models producing different, incomparable vector spaces, so
-- both coexist as separate columns while this prototype is evaluated
-- against real data (see src/lib/ai/imageEmbeddingDino.ts,
-- src/lib/ai/vectorSearch.ts's saveImageEmbeddingDino/
-- findSimilarPostsByImageDino). Nullable, same as every other embedding
-- column: a post with no DINOv2 embedding yet simply doesn't participate
-- in DINOv2-based similarity search.
ALTER TABLE "LostPost" ADD COLUMN "imageEmbeddingDino" vector(384);
ALTER TABLE "FoundPost" ADD COLUMN "imageEmbeddingDino" vector(384);

-- HNSW over cosine distance, matching every other embedding index in this
-- schema. A separate index per column/table, independent of the existing
-- SigLIP-based imageEmbedding indexes.
CREATE INDEX IF NOT EXISTS "idx_lostpost_image_embedding_dino_hnsw"
  ON "LostPost" USING hnsw ("imageEmbeddingDino" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "idx_foundpost_image_embedding_dino_hnsw"
  ON "FoundPost" USING hnsw ("imageEmbeddingDino" vector_cosine_ops);
