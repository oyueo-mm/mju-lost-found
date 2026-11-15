-- LOCAL REHEARSAL ONLY. Never execute against an active job queue.
DROP TRIGGER IF EXISTS "lost_image_cache" ON "LostPost";
DROP TRIGGER IF EXISTS "found_image_cache" ON "FoundPost";
DROP FUNCTION IF EXISTS public.invalidate_image_recommendations();
DROP TRIGGER "lost_image_embedding_job" ON "LostPost";
DROP TRIGGER "found_image_embedding_job" ON "FoundPost";
DROP FUNCTION public.queue_image_embedding();
DROP TABLE "ImageEmbeddingJob";
