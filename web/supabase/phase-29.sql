-- ============================================================================
--  29차: 보안 점검 후속 (MCP DB QA, 2026-09-09)
--
--  adjust_trust / handle_new_user / rls_auto_enable 는 서버(서비스 롤)에서만
--  호출되는데 PostgREST 에 anon/authenticated EXECUTE 권한이 열려 있어
--  누구나 /rest/v1/rpc/adjust_trust 로 자기 명지도를 100 으로 올리거나
--  남의 점수를 0 으로 깎을 수 있는 상태였다. → 외부 호출 차단.
--
--  bump_view(익명 조회수), confirm_deal(참여자 확인 내장) 는 클라이언트가
--  직접 호출하므로 그대로 둔다.
-- ============================================================================

revoke execute on function public.adjust_trust(uuid, numeric) from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.rls_auto_enable() from anon, authenticated;

-- 확인:
--   select p.proname,
--     array(select r.rolname from pg_proc pp
--           join aclexplode(pp.proacl) a on true
--           join pg_roles r on r.oid = a.grantee
--           where pp.oid = p.oid and a.privilege_type='EXECUTE')
--   from pg_proc p
--   where p.pronamespace='public'::regnamespace
--     and p.proname in ('adjust_trust','handle_new_user','rls_auto_enable');
--   -> anon / authenticated 가 목록에 없어야 정상

-- (선택) Auth > Policies 에서 "Leaked password protection" 켜기 — 대시보드 토글, SQL 아님

-- 끝.
