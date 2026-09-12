-- ============================================================================
--  32차: profiles 개인정보 열람 차단 (감사 P0-1)
--
--  기존 "profiles read" 정책이 authenticated 전체에 행 열람을 허용하고, 컬럼 제한이
--  없어서 로그인한 아무나 REST 로 전원의 email·major·student_id·suspension_reason·
--  appeal_text 를 읽을 수 있었다.
--
--  조치: 컬럼 단위 SELECT 권한을 공개해도 되는 4개로 축소.
--    - 게시글·채팅·댓글 조인은 nickname / trust_score 만 쓴다.
--    - 본인 전체 프로필은 서버에서 service_role 로 읽는다 (auth.js getOwnProfile).
--  RLS 정책은 그대로 (행 단위) + 컬럼 권한 (열 단위) 이중.
-- ============================================================================

revoke select on table public.profiles from anon;
revoke select on table public.profiles from authenticated;
grant  select (id, nickname, trust_score, created_at) on table public.profiles to authenticated;

-- 확인 (authenticated 가 볼 수 있는 컬럼만 나와야 함):
--   select column_name from information_schema.column_privileges
--    where table_name='profiles' and grantee='authenticated' and privilege_type='SELECT';
--   -> id, nickname, trust_score, created_at

-- 되돌리기:
--   grant select on table public.profiles to authenticated;

-- 끝.
