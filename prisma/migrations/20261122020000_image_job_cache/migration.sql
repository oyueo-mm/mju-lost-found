-- Invalidation at source change is safe because the job trigger has already
-- cleared the old vector. A second invalidation at completion clears any
-- text-only fallback ranking generated while the new vector was pending.
CREATE FUNCTION public.invalidate_image_recommendations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public."MatchCandidateCache"
  WHERE source_type=CASE TG_TABLE_NAME WHEN 'LostPost' THEN 'lost' ELSE 'found' END
    AND source_post_id=NEW.id;
  RETURN NEW;
END $$;
CREATE TRIGGER "lost_image_cache" AFTER UPDATE OF image_url ON "LostPost" FOR EACH ROW
WHEN (OLD.image_url IS DISTINCT FROM NEW.image_url) EXECUTE FUNCTION public.invalidate_image_recommendations();
CREATE TRIGGER "found_image_cache" AFTER UPDATE OF image_url ON "FoundPost" FOR EACH ROW
WHEN (OLD.image_url IS DISTINCT FROM NEW.image_url) EXECUTE FUNCTION public.invalidate_image_recommendations();
