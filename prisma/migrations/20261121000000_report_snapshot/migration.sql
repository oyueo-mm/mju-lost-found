-- 신고 시점 스냅샷 (release C, M-1): additive, one transaction.
--
-- 1. target_snapshot: what the reported content looked like when the report
--    was filed (text fields, author/sender id, and where its images were
--    copied in the private report-evidence bucket). NULL for every report
--    filed before this migration and for one whose snapshot was purged --
--    such reports keep showing only the live target, exactly as before.
-- 2. snapshot_at: when the snapshot was taken (NULL = never taken).
-- 3. snapshot_purged_at: when retention removed the snapshot and its evidence
--    images (1 year after processing, lib/report/snapshot.ts). The report
--    row itself is untouched by that purge.
-- No existing row is changed; no grant is added (Data API stays off).
--
-- Rollback (schema), after removing the report-evidence objects if wanted:
--   BEGIN;
--   ALTER TABLE "Report" DROP CONSTRAINT "Report_snapshot_check";
--   ALTER TABLE "Report" DROP COLUMN "snapshot_purged_at", DROP COLUMN "snapshot_at", DROP COLUMN "target_snapshot";
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261121000000_report_snapshot';
--   COMMIT;
BEGIN;

ALTER TABLE "Report"
  ADD COLUMN "target_snapshot" JSONB,
  ADD COLUMN "snapshot_at" TIMESTAMP(3),
  ADD COLUMN "snapshot_purged_at" TIMESTAMP(3);

-- a stored snapshot always says when it was taken, and is a JSON object
ALTER TABLE "Report" ADD CONSTRAINT "Report_snapshot_check" CHECK (
  "target_snapshot" IS NULL OR ("snapshot_at" IS NOT NULL AND jsonb_typeof("target_snapshot") = 'object')
);

COMMIT;
