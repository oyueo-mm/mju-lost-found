-- 분실/습득 날짜를 시각과 분리한다. lost_date/found_date는 KST 달력 날짜(DATE,
-- 시간대 없음)이고, lost_at/found_at은 정확한 시각을 알 때만 채운다:
--   날짜+시간 앎 -> 둘 다, 날짜만 앎 -> 날짜만, 날짜도 모름 -> 둘 다 NULL.
ALTER TABLE "LostPost" ADD COLUMN "lost_date" DATE;
ALTER TABLE "FoundPost" ADD COLUMN "found_date" DATE;

-- Backfill: lost_at/found_at are TIMESTAMP(3) holding UTC instants, so read
-- them as UTC, convert to Asia/Seoul wall-clock time, and keep the date.
-- Rows whose time is NULL stay NULL -- no date is guessed.
UPDATE "LostPost"
SET "lost_date" = (("lost_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date
WHERE "lost_at" IS NOT NULL;

UPDATE "FoundPost"
SET "found_date" = (("found_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date
WHERE "found_at" IS NOT NULL;
