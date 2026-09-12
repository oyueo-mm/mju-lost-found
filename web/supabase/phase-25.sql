-- ============================================================================
--  25차: 1:1 문의
--  Supabase SQL Editor 에 붙여넣고 한 번 실행.
-- ============================================================================

create table if not exists inquiries (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  category    text not null,
  message     text not null,
  status      text not null default 'open'
              check (status in ('open', 'answered', 'closed')),
  answer      text,
  answered_by uuid references profiles(id) on delete set null,
  answered_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_inquiries_user on inquiries(user_id, created_at desc);
create index if not exists idx_inquiries_status on inquiries(status, created_at desc);

alter table inquiries enable row level security;

-- 본인 것만 읽기 / 작성. 답변·상태 변경은 서버(admin client)만.
drop policy if exists "inquiry own read" on inquiries;
drop policy if exists "inquiry own insert" on inquiries;
create policy "inquiry own read"   on inquiries for select using (user_id = auth.uid());
create policy "inquiry own insert" on inquiries for insert with check (user_id = auth.uid());

-- 끝.
