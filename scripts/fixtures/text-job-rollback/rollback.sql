-- Function Storage C-2 DB rollback for 20261124000000_text_embedding_jobs.
-- Order: roll the APP back first (to a deployment without textJob.ts), then
-- run this. Verified in the local rehearsal
-- (scripts/regression/text-job-migration-local.sh). Not for Production without
-- a separate approval. Drops only the queue; post rows and vectors are untouched.
-- Afterwards: DELETE FROM _prisma_migrations WHERE migration_name='20261124000000_text_embedding_jobs';
BEGIN;
DROP TRIGGER IF EXISTS "lost_text_embedding_job" ON public."LostPost";
DROP TRIGGER IF EXISTS "found_text_embedding_job" ON public."FoundPost";
DROP TRIGGER IF EXISTS "lost_text_embedding_job_cleanup" ON public."LostPost";
DROP TRIGGER IF EXISTS "found_text_embedding_job_cleanup" ON public."FoundPost";
DROP FUNCTION IF EXISTS public.queue_text_embedding();
DROP TABLE IF EXISTS public."TextEmbeddingJob";
COMMIT;
