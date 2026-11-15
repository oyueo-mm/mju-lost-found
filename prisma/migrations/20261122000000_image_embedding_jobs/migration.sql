CREATE TABLE "ImageEmbeddingJob" (
  post_type text NOT NULL CHECK (post_type IN ('lost','found')),
  post_id integer NOT NULL,
  owner_id integer NOT NULL,
  desired_hash text,
  completed_hash text,
  generation integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','completed','failed')),
  lease_token text,
  lease_until timestamp(3),
  attempts integer NOT NULL DEFAULT 0,
  next_run_at timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  last_error text,
  updated_at timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  PRIMARY KEY (post_type,post_id)
);
CREATE INDEX "ImageEmbeddingJob_pending" ON "ImageEmbeddingJob" (state,next_run_at);

-- Queue and invalidate the old vector in the same transaction as the source
-- mutation. No application crash window between saving a photo and enqueueing.
CREATE FUNCTION public.queue_image_embedding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text; fingerprint text;
BEGIN
  kind := CASE TG_TABLE_NAME WHEN 'LostPost' THEN 'lost' ELSE 'found' END;
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public."ImageEmbeddingJob" WHERE post_type=kind AND post_id=OLD.id;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.image_url IS NULL THEN RETURN NEW; END IF;
  ELSIF NEW.image_url IS NOT DISTINCT FROM OLD.image_url THEN RETURN NEW;
  END IF;
  NEW."imageEmbedding" := NULL;
  fingerprint := CASE WHEN NEW.image_url IS NULL THEN NULL ELSE encode(sha256(convert_to('image-v1:4649052661e53c7000355844105f8a1792088239:' || NEW.image_url,'UTF8')),'hex') END;
  INSERT INTO public."ImageEmbeddingJob" AS j (post_type,post_id,owner_id,desired_hash,state)
  VALUES (kind,NEW.id,NEW.user_id,fingerprint,CASE WHEN fingerprint IS NULL THEN 'completed' ELSE 'pending' END)
  ON CONFLICT(post_type,post_id) DO UPDATE SET owner_id=EXCLUDED.owner_id,
    desired_hash=EXCLUDED.desired_hash,generation=j.generation+1,attempts=0,
    state=EXCLUDED.state,next_run_at=(now() AT TIME ZONE 'UTC'),last_error=NULL,updated_at=(now() AT TIME ZONE 'UTC');
  RETURN NEW;
END $$;
CREATE TRIGGER "lost_image_embedding_job" BEFORE INSERT OR UPDATE OF image_url OR DELETE ON "LostPost" FOR EACH ROW EXECUTE FUNCTION public.queue_image_embedding();
CREATE TRIGGER "found_image_embedding_job" BEFORE INSERT OR UPDATE OF image_url OR DELETE ON "FoundPost" FOR EACH ROW EXECUTE FUNCTION public.queue_image_embedding();
