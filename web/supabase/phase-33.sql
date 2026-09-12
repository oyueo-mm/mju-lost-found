-- ============================================================================
--  33차: 요청 제한 (rate limit) — 감사 P1-5
--
--  사용자·행동별 고정 창(fixed window) 카운터. 서버가 service_role 로만 호출한다.
--  예: check_rate_limit(uid, 'post', 5, 600) → 10분에 5회까지 true, 넘으면 false.
-- ============================================================================

create table if not exists public.rate_limits (
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  action       text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (user_id, action, window_start)
);

alter table public.rate_limits enable row level security;
-- 정책 없음 = 클라이언트 접근 불가. service_role 만.

create or replace function public.check_rate_limit(
  p_user uuid, p_action text, p_limit integer, p_window_sec integer
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  ws timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_sec) * p_window_sec);
  c  integer;
begin
  insert into rate_limits (user_id, action, window_start, count)
  values (p_user, p_action, ws, 1)
  on conflict (user_id, action, window_start)
  do update set count = rate_limits.count + 1
  returning count into c;

  -- 지난 창 정리 (호출의 1% 확률로, 하루 지난 것)
  if random() < 0.01 then
    delete from rate_limits where window_start < now() - interval '1 day';
  end if;

  return c <= p_limit;
end $$;

-- 외부에서 직접 호출 못 하게
revoke execute on function public.check_rate_limit(uuid, text, integer, integer) from anon, authenticated;

-- 확인:
--   select check_rate_limit('00000000-0000-0000-0000-000000000000', 'test', 2, 60);  -- true
--   (같은 줄 3번 실행하면 세 번째는 false)
--   delete from rate_limits where action = 'test';

-- 끝.
