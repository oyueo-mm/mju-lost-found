-- 게시판 댓글순 정렬: each post keeps the number of its visible comments
-- (replies included; not deleted tombstones, not comments temporarily hidden
-- on a report) -- the same rule as comment/service.ts countCommentsForPost().
-- Kept by a trigger on "Comment", so every path that adds, deletes, hides or
-- restores a comment (app code, admin actions, cascades) updates it without
-- any app change, and the board can ORDER BY it in one query.
BEGIN;

ALTER TABLE "LostPost" ADD COLUMN "comment_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FoundPost" ADD COLUMN "comment_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "LostPost" p SET "comment_count" = (
  SELECT count(*) FROM "Comment" c
  WHERE c."lost_post_id" = p."id" AND c."deleted_at" IS NULL AND c."temp_hidden_at" IS NULL
);
UPDATE "FoundPost" p SET "comment_count" = (
  SELECT count(*) FROM "Comment" c
  WHERE c."found_post_id" = p."id" AND c."deleted_at" IS NULL AND c."temp_hidden_at" IS NULL
);

-- Recounts the post(s) a changed comment belongs to (before and after the
-- change). A recount rather than +1/-1, so it can never drift.
CREATE FUNCTION "refresh_post_comment_count"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  lost_ids INTEGER[] := ARRAY[]::INTEGER[];
  found_ids INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF OLD."lost_post_id" IS NOT NULL THEN lost_ids := lost_ids || OLD."lost_post_id"; END IF;
    IF OLD."found_post_id" IS NOT NULL THEN found_ids := found_ids || OLD."found_post_id"; END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF NEW."lost_post_id" IS NOT NULL THEN lost_ids := lost_ids || NEW."lost_post_id"; END IF;
    IF NEW."found_post_id" IS NOT NULL THEN found_ids := found_ids || NEW."found_post_id"; END IF;
  END IF;
  IF cardinality(lost_ids) > 0 THEN
    UPDATE "LostPost" p SET "comment_count" = (
      SELECT count(*) FROM "Comment" c
      WHERE c."lost_post_id" = p."id" AND c."deleted_at" IS NULL AND c."temp_hidden_at" IS NULL
    ) WHERE p."id" = ANY(lost_ids);
  END IF;
  IF cardinality(found_ids) > 0 THEN
    UPDATE "FoundPost" p SET "comment_count" = (
      SELECT count(*) FROM "Comment" c
      WHERE c."found_post_id" = p."id" AND c."deleted_at" IS NULL AND c."temp_hidden_at" IS NULL
    ) WHERE p."id" = ANY(found_ids);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "comment_count_refresh"
AFTER INSERT OR DELETE OR UPDATE OF "deleted_at", "temp_hidden_at", "lost_post_id", "found_post_id" ON "Comment"
FOR EACH ROW EXECUTE FUNCTION "refresh_post_comment_count"();

COMMIT;
