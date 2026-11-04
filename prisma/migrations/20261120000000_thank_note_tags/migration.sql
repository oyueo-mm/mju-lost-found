-- 감사 후기 칭찬 태그 (Phase 3-B): additive, one transaction. NOT APPLIED --
-- waiting for approval (docs/THANK_NOTES.md, "칭찬 태그 마이그레이션").
--
-- 1. tags: the praise tags the sender picked (any of five fixed codes, any
--    number, none allowed). Existing rows get '{}' -- no tag is invented for
--    an older note.
-- 2. body may now be empty when at least one tag is chosen; still at most 500
--    characters. Every existing row already has a 1..500 body, so it passes
--    the new checks unchanged. No stored row is changed.
--
-- Rollback (only while no tag-only note exists; check first:
--   SELECT count(*) FROM "ThankNote" WHERE char_length(btrim(body)) = 0;):
--   BEGIN;
--   ALTER TABLE "ThankNote" DROP CONSTRAINT "ThankNote_tags_check";
--   ALTER TABLE "ThankNote" DROP CONSTRAINT "ThankNote_content_check";
--   ALTER TABLE "ThankNote" DROP CONSTRAINT "ThankNote_body_length_check";
--   ALTER TABLE "ThankNote" ADD CONSTRAINT "ThankNote_body_check" CHECK (char_length("body") BETWEEN 1 AND 500);
--   ALTER TABLE "ThankNote" DROP COLUMN "tags";
--   COMMIT;
BEGIN;

ALTER TABLE "ThankNote" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "ThankNote" DROP CONSTRAINT "ThankNote_body_check";
ALTER TABLE "ThankNote" ADD CONSTRAINT "ThankNote_body_length_check" CHECK (char_length("body") <= 500);
ALTER TABLE "ThankNote" ADD CONSTRAINT "ThankNote_content_check" CHECK (char_length(btrim("body")) > 0 OR cardinality("tags") > 0);
ALTER TABLE "ThankNote" ADD CONSTRAINT "ThankNote_tags_check" CHECK ("tags" <@ ARRAY['kind', 'quick_reply', 'kept_well', 'helpful', 'kept_promise']::TEXT[]);

COMMIT;
