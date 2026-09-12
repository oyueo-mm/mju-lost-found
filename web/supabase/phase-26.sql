-- ============================================================================
--  26차: 1:1 문의 스레드화 (답장 주고받기)
--  ⚠️ phase-25(inquiries) 실행 후에.
-- ============================================================================

create table if not exists inquiry_messages (
  id         bigint generated always as identity primary key,
  inquiry_id bigint not null references inquiries(id) on delete cascade,
  sender_id  uuid references profiles(id) on delete set null,
  staff      boolean not null default false,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_inq_msg on inquiry_messages(inquiry_id, created_at);

alter table inquiries add column if not exists last_message_at timestamptz;

alter table inquiry_messages enable row level security;
drop policy if exists "inq msg read" on inquiry_messages;
create policy "inq msg read" on inquiry_messages for select
  using (exists (
    select 1 from inquiries i
    where i.id = inquiry_messages.inquiry_id and i.user_id = auth.uid()
  ));
-- 쓰기는 서버(admin client) 전용

-- 기존 문의 본문/답변을 스레드로 이관 (한 번만)
insert into inquiry_messages (inquiry_id, sender_id, staff, body, created_at)
select id, user_id, false, message, created_at
from inquiries q
where not exists (select 1 from inquiry_messages m where m.inquiry_id = q.id and m.staff = false);

insert into inquiry_messages (inquiry_id, sender_id, staff, body, created_at)
select id, answered_by, true, answer, coalesce(answered_at, created_at)
from inquiries q
where answer is not null
  and not exists (select 1 from inquiry_messages m where m.inquiry_id = q.id and m.staff = true);

update inquiries set last_message_at = coalesce(answered_at, created_at)
where last_message_at is null;

-- 끝.
