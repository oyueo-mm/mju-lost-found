BEGIN;
-- Function Storage C-2: post text re-embedding becomes a durable queue drained
-- by the model-carrying /api/posts function, so /api/posts/[id] ships no model.
-- Additive only: no existing row or vector changes, no backfill. Deployments
-- without this protocol keep embedding inline and simply ignore the table.
CREATE TABLE public."TextEmbeddingJob" (
  post_type text NOT NULL CHECK (post_type IN ('lost','found')),
  post_id integer NOT NULL,
  generation integer NOT NULL DEFAULT 1,
  completed_generation integer,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','completed','failed')),
  lease_token text,
  lease_until timestamp(3),
  attempts integer NOT NULL DEFAULT 0,
  next_run_at timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  last_error text,
  updated_at timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  PRIMARY KEY (post_type, post_id)
);
CREATE INDEX "TextEmbeddingJob_pending" ON public."TextEmbeddingJob" (state, next_run_at);

-- Server-only queue. No client policies; explicitly drop anything a default
-- ACL may have granted to client roles (Production still has residual
-- default ACLs, see docs/operations DB privileges audit 2026-11-12).
ALTER TABLE public."TextEmbeddingJob" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."TextEmbeddingJob" FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public."TextEmbeddingJob" FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Queue in the same transaction as the text change; the post row lock is
-- held, so a worker that locks post then job sees either the old or the new
-- generation, never a half state. Only real changes of the four fields that
-- feed buildEmbeddingText() (title, description, category, location) count.
CREATE FUNCTION public.queue_text_embedding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text;
BEGIN
  kind := CASE TG_TABLE_NAME WHEN 'LostPost' THEN 'lost' ELSE 'found' END;
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public."TextEmbeddingJob" WHERE post_type = kind AND post_id = OLD.id;
    RETURN OLD;
  END IF;
  INSERT INTO public."TextEmbeddingJob" AS j (post_type, post_id) VALUES (kind, NEW.id)
  ON CONFLICT (post_type, post_id) DO UPDATE SET
    generation = j.generation + 1, state = 'pending', attempts = 0,
    next_run_at = (now() AT TIME ZONE 'UTC'), last_error = NULL,
    updated_at = (now() AT TIME ZONE 'UTC');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.queue_text_embedding() FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.queue_text_embedding() FROM %I', r);
    END IF;
  END LOOP;
END $$;

CREATE TRIGGER "lost_text_embedding_job" AFTER UPDATE OF title, description, category, location ON public."LostPost"
FOR EACH ROW WHEN (OLD.title IS DISTINCT FROM NEW.title OR OLD.description IS DISTINCT FROM NEW.description
  OR OLD.category IS DISTINCT FROM NEW.category OR OLD.location IS DISTINCT FROM NEW.location)
EXECUTE FUNCTION public.queue_text_embedding();
CREATE TRIGGER "found_text_embedding_job" AFTER UPDATE OF title, description, category, location ON public."FoundPost"
FOR EACH ROW WHEN (OLD.title IS DISTINCT FROM NEW.title OR OLD.description IS DISTINCT FROM NEW.description
  OR OLD.category IS DISTINCT FROM NEW.category OR OLD.location IS DISTINCT FROM NEW.location)
EXECUTE FUNCTION public.queue_text_embedding();
CREATE TRIGGER "lost_text_embedding_job_cleanup" AFTER DELETE ON public."LostPost"
FOR EACH ROW EXECUTE FUNCTION public.queue_text_embedding();
CREATE TRIGGER "found_text_embedding_job_cleanup" AFTER DELETE ON public."FoundPost"
FOR EACH ROW EXECUTE FUNCTION public.queue_text_embedding();
COMMIT;
