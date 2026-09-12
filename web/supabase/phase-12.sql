-- ============================================================================
--  12차: 신고 대화 열람 — 관리자 전원 동의 게이트
-- ============================================================================

create table if not exists report_transcript_approvals (
  id         bigint generated always as identity primary key,
  report_id  bigint not null references reports(id) on delete cascade,
  admin_id   uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (report_id, admin_id)
);
create index if not exists idx_transcript_appr_report
  on report_transcript_approvals(report_id);

alter table report_transcript_approvals enable row level security;

create policy "transcript appr: staff read" on report_transcript_approvals
  for select using (
    exists (select 1 from profiles p
            where p.id = auth.uid() and p.role in ('owner', 'admin'))
  );
create policy "transcript appr: self insert" on report_transcript_approvals
  for insert with check (
    admin_id = auth.uid() and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('owner', 'admin')
    )
  );
