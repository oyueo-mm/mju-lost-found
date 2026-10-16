-- 최근 활동 감지 시각 (관리자 사용자 상세): one nullable column on "User",
-- written at most every few minutes by metrics/record.ts
-- recordMemberActivity. Additive only: existing rows stay NULL (no
-- backfill -- earlier activity times were never recorded).
ALTER TABLE "User" ADD COLUMN "last_active_at" TIMESTAMP(3);
