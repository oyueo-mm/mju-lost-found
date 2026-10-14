-- 실명·학과 자동 입력: where each saved value came from (the member's own
-- input, or a Google suggestion they kept). Additive; existing rows are
-- marked "self", which is what they are.
BEGIN;

ALTER TABLE "UserIdentityInfo" ADD COLUMN "real_name_source" TEXT NOT NULL DEFAULT 'self';
ALTER TABLE "UserIdentityInfo" ADD COLUMN "department_source" TEXT NOT NULL DEFAULT 'self';

COMMIT;
