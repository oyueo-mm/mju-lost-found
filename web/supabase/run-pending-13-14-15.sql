-- ============================================================================
--  아직 실행 안 된 마이그레이션 모음 (phase-13 + 14 + 15)
--  Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run.
--  전부 idempotent — 여러 번 돌려도 안전.
-- ============================================================================

-- ── 13: 운영자(owner) 등급 폐지 ──────────────────────────────
update profiles set role = 'admin' where role = 'owner';

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles
  add constraint profiles_role_check check (role in ('admin', 'user'));

update profiles set is_admin = (role = 'admin');

drop policy if exists "transcript appr: staff read"   on report_transcript_approvals;
drop policy if exists "transcript appr: self insert"  on report_transcript_approvals;

create policy "transcript appr: staff read" on report_transcript_approvals
  for select using (
    exists (select 1 from profiles p
            where p.id = auth.uid() and p.role = 'admin')
  );
create policy "transcript appr: self insert" on report_transcript_approvals
  for insert with check (
    admin_id = auth.uid() and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ── 14: 게시글 조회수 ────────────────────────────────────────
alter table lost_posts  add column if not exists view_count integer not null default 0;
alter table found_posts add column if not exists view_count integer not null default 0;

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

-- ── 15: 채팅 사진 첨부 ───────────────────────────────────────
alter table messages add column if not exists image_url text;
