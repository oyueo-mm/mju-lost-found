-- ============================================================================
--  30차: 총관리자(owner) 지정 — 관리자끼리 팀킬(강등·정지·삭제) 방지 백스톱
--
--  profiles.role 은 이미 ('owner','admin','user') 만 허용하는 check 제약이 있음.
--  owner 는 앱에서 관리자 기능을 모두 쓰되, 다른 관리자가
--  setUserRole / setUserSuspension / adminDeleteUser 로 건드릴 수 없다.
--  owner 지정·해제는 이 SQL 에서만 한다.
-- ============================================================================

-- 총관리자로 지정 (본인 계정)
update profiles
   set role = 'owner', is_admin = true
 where email = 'ysm0608020@mju.ac.kr';

-- 확인
select email, nickname, role, is_admin from profiles where role = 'owner';

-- 되돌리려면:
--   update profiles set role = 'admin' where email = 'ysm0608020@mju.ac.kr';

-- 끝.
