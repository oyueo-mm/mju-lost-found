-- 이름·소속 열람 목적 확대: an admin may now view a member's 이름·소속 for a
-- stated operating purpose -- 분실물 인계 문의, 소유권 분쟁, 사칭 의심 --
-- besides handling a report, so a view is no longer always tied to a
-- report. Every view still gets one IdentityAccessLog row; existing rows are
-- all report views and keep their report.
BEGIN;

ALTER TABLE "IdentityAccessLog" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'report';
ALTER TABLE "IdentityAccessLog" ALTER COLUMN "report_id" DROP NOT NULL;

-- Only the purposes the privacy policy (§5) names, and a report view always
-- names its report while an operating-purpose view never does.
ALTER TABLE "IdentityAccessLog" ADD CONSTRAINT "IdentityAccessLog_purpose_check"
  CHECK ("purpose" IN ('report', 'handover', 'ownership_dispute', 'impersonation'));
ALTER TABLE "IdentityAccessLog" ADD CONSTRAINT "IdentityAccessLog_purpose_report_check"
  CHECK (("purpose" = 'report') = ("report_id" IS NOT NULL));

COMMIT;
