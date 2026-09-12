-- ============================================================================
--  20차: 약관 / 개인정보 동의 기록
--  Supabase SQL Editor 에 붙여넣고 한 번 실행.
-- ============================================================================

alter table profiles
  add column if not exists terms_agreed_at    timestamptz,
  add column if not exists privacy_agreed_at  timestamptz,
  add column if not exists overseas_agreed_at timestamptz,
  add column if not exists terms_version      text;

-- 끝. 기존 이용자는 terms_version 이 NULL 이므로 다음 접속 시 동의 화면으로 안내됨.
