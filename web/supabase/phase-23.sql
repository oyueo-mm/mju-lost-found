-- ============================================================================
--  23차: 관리자 공지
--  Supabase SQL Editor 에 붙여넣고 한 번 실행.
-- ============================================================================

create table if not exists notices (
  id              bigint generated always as identity primary key,
  title           text not null,
  body            text not null default '',
  link            text,
  sent_by         uuid references profiles(id) on delete set null,
  recipient_count int not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists idx_notices_created on notices(created_at desc);

-- 서버(admin client) 전용.
alter table notices enable row level security;

-- 끝.
