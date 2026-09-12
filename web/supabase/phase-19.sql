-- ============================================================================
--  19차: 정지 사유 + 이의 제기
--  Supabase SQL Editor 에 붙여넣고 한 번 실행.
-- ============================================================================

alter table profiles
  add column if not exists suspension_reason text,
  add column if not exists appeal_text       text,
  add column if not exists appeal_at          timestamptz;

-- 끝.
