BEGIN;
-- A durable switch allows promotion followed by draining all pre-D2 functions.
-- New jobs continue to be queued while execution is paused. No backfill.
CREATE TABLE public."ImageEmbeddingRuntime" (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  resume_at timestamp(3)
);
INSERT INTO public."ImageEmbeddingRuntime"(id) VALUES (true);
ALTER TABLE public."ImageEmbeddingRuntime" ENABLE ROW LEVEL SECURITY;

-- Legacy deployments/tools write vectors without a job token. Preserve their
-- other mutations, but never accept their late result or late NULL write.
-- This is a concurrency fence for trusted server code, not DB authentication.
CREATE FUNCTION public.fence_image_embedding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text; fingerprint text; active public."ImageEmbeddingJob"%ROWTYPE;
BEGIN
  IF NEW.image_url IS DISTINCT FROM OLD.image_url THEN
    NEW."imageEmbedding" := NULL;
    RETURN NEW; -- source trigger has queued the new input in this transaction
  END IF;
  IF NEW."imageEmbedding" IS NOT DISTINCT FROM OLD."imageEmbedding" THEN RETURN NEW; END IF;
  kind := CASE TG_TABLE_NAME WHEN 'LostPost' THEN 'lost' ELSE 'found' END;
  fingerprint := CASE WHEN NEW.image_url IS NULL THEN NULL ELSE encode(sha256(convert_to('image-v1:4649052661e53c7000355844105f8a1792088239:' || NEW.image_url,'UTF8')),'hex') END;
  SELECT * INTO active FROM public."ImageEmbeddingJob" WHERE post_type=kind AND post_id=NEW.id FOR UPDATE;
  IF active.lease_token IS NOT NULL
     AND active.lease_token=current_setting('mju.image_job_token',true)
     AND active.generation::text=current_setting('mju.image_job_generation',true)
     AND active.desired_hash=fingerprint
     AND active.state='running'
     AND active.lease_until > (clock_timestamp() AT TIME ZONE 'UTC') THEN RETURN NEW;
  END IF;
  NEW."imageEmbedding" := OLD."imageEmbedding";
  IF fingerprint IS NOT NULL THEN
    INSERT INTO public."ImageEmbeddingJob"(post_type,post_id,owner_id,desired_hash)
    VALUES(kind,NEW.id,NEW.user_id,fingerprint) ON CONFLICT(post_type,post_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "lost_image_vector_fence" BEFORE UPDATE OF "imageEmbedding" ON public."LostPost"
FOR EACH ROW EXECUTE FUNCTION public.fence_image_embedding();
CREATE TRIGGER "found_image_vector_fence" BEFORE UPDATE OF "imageEmbedding" ON public."FoundPost"
FOR EACH ROW EXECUTE FUNCTION public.fence_image_embedding();
COMMIT;
