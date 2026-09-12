-- ============================================================================
--  18차: 신고 인용 시 명지도 감점
--  신고가 기각(dismiss)이 아닌 방식으로 처리되면 신고 대상 사용자 -3%p
-- ============================================================================

create or replace function adjust_trust(p_user uuid, p_delta numeric)
returns numeric
language sql
security definer
set search_path = public
as $$
  update profiles
     set trust_score = greatest(0, least(100, trust_score + p_delta))
   where id = p_user
  returning trust_score;
$$;

revoke all on function adjust_trust(uuid, numeric) from public;
grant execute on function adjust_trust(uuid, numeric) to service_role;
