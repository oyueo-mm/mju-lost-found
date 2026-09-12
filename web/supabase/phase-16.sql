-- ============================================================================
--  16차: 조회수 1인 1회 제한
--  같은 사람이 같은 글을 여러 번 열어도 조회수는 한 번만 올라간다.
-- ============================================================================

create table if not exists post_views (
  user_id   uuid   not null references profiles(id) on delete cascade,
  post_kind text   not null check (post_kind in ('lost', 'found')),
  post_id   bigint not null,
  viewed_at timestamptz not null default now(),
  primary key (user_id, post_kind, post_id)
);

-- 직접 접근 차단 — 아래 SECURITY DEFINER 함수로만 기록/증가
alter table post_views enable row level security;

create or replace function bump_view(p_kind text, p_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count    integer;
  v_inserted integer;
begin
  if p_kind not in ('lost', 'found') then
    return 0;
  end if;

  -- 로그인 안 된 호출이면 증가 없이 현재 값만 반환
  if auth.uid() is null then
    if p_kind = 'lost' then
      select view_count into v_count from lost_posts  where id = p_id;
    else
      select view_count into v_count from found_posts where id = p_id;
    end if;
    return coalesce(v_count, 0);
  end if;

  -- 이 사람이 이 글을 처음 보는 경우에만 카운트
  insert into post_views (user_id, post_kind, post_id)
  values (auth.uid(), p_kind, p_id)
  on conflict (user_id, post_kind, post_id) do nothing;
  get diagnostics v_inserted = row_count;

  if p_kind = 'lost' then
    if v_inserted > 0 then
      update lost_posts set view_count = view_count + 1
        where id = p_id returning view_count into v_count;
    else
      select view_count into v_count from lost_posts where id = p_id;
    end if;
  else
    if v_inserted > 0 then
      update found_posts set view_count = view_count + 1
        where id = p_id returning view_count into v_count;
    else
      select view_count into v_count from found_posts where id = p_id;
    end if;
  end if;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function bump_view(text, bigint) from public;
grant execute on function bump_view(text, bigint) to authenticated;
