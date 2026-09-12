-- ============================================================================
--  2차 기능: 채팅 / 알림 / 신고 / 관리자
--  Supabase SQL Editor 에 붙여넣고 한 번 실행.
-- ============================================================================

create table if not exists chat_rooms (
  id              bigint generated always as identity primary key,
  user_a          uuid not null references profiles(id) on delete cascade,
  user_b          uuid not null references profiles(id) on delete cascade,
  match_id        bigint references matches(id) on delete set null,
  lost_post_id    bigint references lost_posts(id) on delete set null,
  found_post_id   bigint references found_posts(id) on delete set null,
  context_title   text,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (user_a, user_b, lost_post_id, found_post_id)
);
create index if not exists idx_chat_rooms_a on chat_rooms(user_a, last_message_at desc);
create index if not exists idx_chat_rooms_b on chat_rooms(user_b, last_message_at desc);

create table if not exists messages (
  id         bigint generated always as identity primary key,
  room_id    bigint not null references chat_rooms(id) on delete cascade,
  sender_id  uuid not null references profiles(id) on delete cascade,
  content    text not null,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_messages_room on messages(room_id, created_at);

create table if not exists notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text not null default '',
  link       text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_user on notifications(user_id, is_read, created_at desc);

create table if not exists reports (
  id          bigint generated always as identity primary key,
  reporter_id uuid not null references profiles(id) on delete cascade,
  target_type text not null check (target_type in ('lost_post', 'found_post', 'message', 'user')),
  target_id   text not null,
  reason      text not null,
  detail      text,
  status      text not null default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id),
  created_at  timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table chat_rooms    enable row level security;
alter table messages      enable row level security;
alter table notifications enable row level security;
alter table reports       enable row level security;

create policy "rooms participant read" on chat_rooms for select
  using (auth.uid() = user_a or auth.uid() = user_b);

create policy "messages participant read" on messages for select
  using (exists (
    select 1 from chat_rooms r
    where r.id = messages.room_id and (r.user_a = auth.uid() or r.user_b = auth.uid())
  ));

create policy "messages participant send" on messages for insert
  with check (
    sender_id = auth.uid() and exists (
      select 1 from chat_rooms r
      where r.id = room_id and (r.user_a = auth.uid() or r.user_b = auth.uid())
    )
  );

create policy "messages mark read" on messages for update
  using (exists (
    select 1 from chat_rooms r
    where r.id = messages.room_id and (r.user_a = auth.uid() or r.user_b = auth.uid())
  ));

create policy "notif own read"   on notifications for select using (user_id = auth.uid());
create policy "notif own update" on notifications for update using (user_id = auth.uid());

create policy "reports insert own" on reports for insert with check (reporter_id = auth.uid());
create policy "reports admin read" on reports for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
create policy "reports admin update" on reports for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

-- 실시간 채팅
alter publication supabase_realtime add table messages;
