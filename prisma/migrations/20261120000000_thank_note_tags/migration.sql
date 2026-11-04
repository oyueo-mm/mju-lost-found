-- 감사 후기 칭찬 태그 (Phase 3-B): additive, one transaction.
--
-- 1. tags: the praise tags the sender picked -- any of five fixed codes, each
--    at most once, any number (none allowed). Existing rows get '{}': no tag
--    is invented for an older note.
-- 2. body may now be empty when at least one tag is chosen; still at most 500
--    characters. "Has content" means a non-whitespace character in body
--    (spaces, tabs and line breaks alone do not count) or at least one tag.
--    Every existing row already has a trimmed 1..500 body, so it passes the
--    new checks unchanged (ADD CONSTRAINT validates them; any failure aborts
--    the whole transaction). No stored row is changed.
--
-- Rollback (schema), only while no tag-only note exists -- check first:
--   SELECT count(*) FROM "ThankNote" WHERE "body" !~ '[^[:space:]]';
--   BEGIN;
--   ALTER TABLE "ThankNote" DROP CONSTRAINT "ThankNote_tags_unique_check";
--   ALTER TABLE "ThankNote" DROP CONSTRAINT "ThankNote_tags_check";
--   ALTER TABLE "ThankNote" DROP CONSTRAINT "ThankNote_content_check";
--   ALTER TABLE "ThankNote" DROP CONSTRAINT "ThankNote_body_length_check";
--   ALTER TABLE "ThankNote" ADD CONSTRAINT "ThankNote_body_check" CHECK (char_length("body") BETWEEN 1 AND 500);
--   ALTER TABLE "ThankNote" DROP COLUMN "tags";
--   DROP FUNCTION "thank_note_tags_unique"(TEXT[]);
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261120000000_thank_note_tags';
--   COMMIT;
BEGIN;

-- true when no tag repeats (a CHECK cannot hold a subquery itself)
CREATE FUNCTION "thank_note_tags_unique"(t TEXT[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT count(*) = count(DISTINCT x) FROM unnest(t) AS x $$;

ALTER TABLE "ThankNote" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "ThankNote" DROP CONSTRAINT "ThankNote_body_check";
ALTER TABLE "ThankNote" ADD CONSTRAINT "ThankNote_body_length_check" CHECK (char_length("body") <= 500);
ALTER TABLE "ThankNote" ADD CONSTRAINT "ThankNote_content_check" CHECK ("body" ~ '[^[:space:]]' OR cardinality("tags") > 0);
ALTER TABLE "ThankNote" ADD CONSTRAINT "ThankNote_tags_check" CHECK ("tags" <@ ARRAY['kind', 'quick_reply', 'kept_well', 'helpful', 'kept_promise']::TEXT[]);
ALTER TABLE "ThankNote" ADD CONSTRAINT "ThankNote_tags_unique_check" CHECK ("thank_note_tags_unique"("tags"));

COMMIT;
