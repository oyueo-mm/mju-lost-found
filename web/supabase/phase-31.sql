-- ============================================================================
--  31차: 성능 — RLS auth.uid() 초기화 플랜 + 외래키 인덱스
--  (Supabase 성능 어드바이저 auth_rls_initplan 31건 / unindexed_foreign_keys 13건)
--
--  1) RLS 정책 안의 auth.uid() / auth.role() / auth.jwt() 를 (select auth.xxx())
--     로 감싼다. 감싸면 행마다 재평가하지 않고 쿼리당 1번만 평가한다.
--     정책을 하나씩 손으로 다시 쓰지 않고, pg_policies 를 읽어 자동으로
--     drop → create 한다. 이미 감싸진 정책은 건드리지 않는다.
--  2) FK 컬럼 인덱스 13개.
--
--  안전: 정책 본문(qual / with_check)만 바뀌고 권한 의미는 동일.
--  실행 후 Supabase 대시보드 > Advisors > Performance 에서 두 항목이 사라지면 성공.
-- ============================================================================

-- ── 1) RLS 정책 재작성 ───────────────────────────────────────────────────────
do $$
declare
  p          record;
  using_sql  text;
  check_sql  text;
  roles_sql  text;
  n          int := 0;
begin
  for p in
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
       -- pg_policies 는 이미 감싸진 것을 "( SELECT auth.uid() AS uid)" 로 보여주므로
       -- 대소문자 무시(~*, 'gi')로 "select " 바로 뒤가 아닌 auth.xxx() 만 잡는다.
       and (coalesce(qual, '') ~* '(?<!select )auth\.(uid|role|jwt)\(\)'
         or coalesce(with_check, '') ~* '(?<!select )auth\.(uid|role|jwt)\(\)')
  loop
    using_sql := regexp_replace(p.qual,       '(?<!select )auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'gi');
    check_sql := regexp_replace(p.with_check, '(?<!select )auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'gi');
    roles_sql := array_to_string(p.roles, ', ');

    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    execute format(
      'create policy %I on %I.%I as %s for %s to %s %s %s',
      p.policyname, p.schemaname, p.tablename,
      p.permissive, p.cmd, roles_sql,
      case when using_sql is not null then 'using (' || using_sql || ')' else '' end,
      case when check_sql is not null then 'with check (' || check_sql || ')' else '' end
    );
    n := n + 1;
  end loop;
  raise notice 'RLS 정책 % 개 재작성', n;
end $$;

-- ── 2) 외래키 인덱스 ────────────────────────────────────────────────────────
create index if not exists idx_app_settings_updated_by      on app_settings (updated_by);
create index if not exists idx_chat_rooms_found_post_id     on chat_rooms (found_post_id);
create index if not exists idx_chat_rooms_lost_post_id      on chat_rooms (lost_post_id);
create index if not exists idx_chat_rooms_match_id          on chat_rooms (match_id);
create index if not exists idx_comments_user_id             on comments (user_id);
create index if not exists idx_inquiries_answered_by        on inquiries (answered_by);
create index if not exists idx_inquiry_messages_sender_id   on inquiry_messages (sender_id);
create index if not exists idx_matches_found_post_id        on matches (found_post_id);
create index if not exists idx_message_reactions_user_id    on message_reactions (user_id);
create index if not exists idx_messages_sender_id           on messages (sender_id);
create index if not exists idx_notices_sent_by              on notices (sent_by);
create index if not exists idx_rta_admin_id                 on report_transcript_approvals (admin_id);
create index if not exists idx_reports_resolved_by          on reports (resolved_by);

-- 확인:
--   select policyname, tablename from pg_policies
--    where schemaname='public' and (qual ~* '(?<!select )auth\.' or with_check ~* '(?<!select )auth\.');
--   -> 0 행이면 정상

-- 끝.
