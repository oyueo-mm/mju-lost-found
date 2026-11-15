BEGIN;
-- Pre-fence D2 Preview workers also knew the job table. Refuse their old
-- claim protocol before inference, and recover a claim already in flight.
CREATE FUNCTION public.fence_image_job_protocol() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lease_token IS NOT NULL AND NEW.lease_token IS DISTINCT FROM OLD.lease_token THEN
    IF NEW.lease_token NOT LIKE 'image-v2:%' OR NOT EXISTS(
      SELECT 1 FROM public."ImageEmbeddingRuntime" WHERE id=true AND enabled
        AND resume_at <= (clock_timestamp() AT TIME ZONE 'UTC')
    ) THEN RETURN NULL; END IF;
  END IF;
  IF NEW.state='completed' AND NEW.desired_hash IS NOT NULL AND NEW.completed_hash IS NOT NULL
     AND (OLD.state IS DISTINCT FROM NEW.state OR OLD.completed_hash IS DISTINCT FROM NEW.completed_hash) THEN
    IF OLD.lease_token=current_setting('mju.image_job_token',true)
       AND OLD.generation::text=current_setting('mju.image_job_generation',true)
       AND NEW.desired_hash=NEW.completed_hash THEN
      IF OLD.lease_until <= (clock_timestamp() AT TIME ZONE 'UTC') THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Image job lease expired before completion';
      END IF;
    ELSE
      NEW.state := 'pending'; NEW.completed_hash := OLD.completed_hash;
      NEW.lease_token := NULL; NEW.lease_until := NULL;
      NEW.attempts := GREATEST(0,OLD.attempts-1);
      NEW.next_run_at := (clock_timestamp() AT TIME ZONE 'UTC');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "image_job_protocol_fence" BEFORE UPDATE ON public."ImageEmbeddingJob"
FOR EACH ROW EXECUTE FUNCTION public.fence_image_job_protocol();
COMMIT;
