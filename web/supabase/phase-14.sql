-- ============================================================================
--  14차: 게시글 조회수
--  (bump_view 는 create or replace 이므로 여러 번 실행해도 안전)
-- ============================================================================

alter table lost_posts  add column if not exists view_count integer not null default 0;
alter table found_posts add column if not exists view_count integer not null default 0;

-- 조회수 원자적 증가 후 새 값을 돌려준다. RLS 우회, 로그인 사용자만 호출 가능.
create or replace function bump_view(p_kind text, p_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_kind = 'lost' then
    update lost_posts  set view_count = view_count + 1
      where id = p_id returning view_count into v_count;
  elsif p_kind = 'found' then
    update found_posts set view_count = view_count + 1
      where id = p_id returning view_count into v_count;
  end if;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function bump_view(text, bigint) from public;
grant execute on function bump_view(text, bigint) to authenticated;
