-- ============================================================================
--  13차: 운영자(owner) 등급 폐지 → 관리자(admin)로 통합
--  이제 권한은 관리자(admin) / 일반(user) 2단계.
-- ============================================================================

-- 1) 기존 운영자를 관리자로 승계
update profiles set role = 'admin' where role = 'owner';

-- 2) role 체크 제약을 admin / user 로 축소
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles
  add constraint profiles_role_check check (role in ('admin', 'user'));

-- 3) is_admin 미러 재동기화
update profiles set is_admin = (role = 'admin');

-- 4) owner 를 참조하던 RLS 정책 정리 (phase-12)
drop policy if exists "transcript appr: staff read" on report_transcript_approvals;
drop policy if exists "transcript appr: self insert" on report_transcript_approvals;

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
