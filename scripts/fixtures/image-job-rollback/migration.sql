-- LOCAL REHEARSAL ONLY. Never execute against an active job queue.
DROP TRIGGER "lost_image_embedding_job" ON "LostPost";
DROP TRIGGER "found_image_embedding_job" ON "FoundPost";
DROP FUNCTION public.queue_image_embedding();
DROP TABLE "ImageEmbeddingJob";
