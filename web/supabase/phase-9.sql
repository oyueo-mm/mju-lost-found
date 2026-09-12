-- ============================================================================
--  9차: 채팅 메시지 이모지 반응
-- ============================================================================

create table if not exists message_reactions (
  id         bigint generated always as identity primary key,
  message_id bigint not null references messages(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
create index if not exists idx_reactions_msg on message_reactions(message_id);

alter table message_reactions enable row level security;

create policy "reactions read" on message_reactions for select using (
  exists (
    select 1 from messages m join chat_rooms r on r.id = m.room_id
    where m.id = message_reactions.message_id
      and (r.user_a = auth.uid() or r.user_b = auth.uid())
  )
);
create policy "reactions add" on message_reactions for insert with check (
  user_id = auth.uid() and exists (
    select 1 from messages m join chat_rooms r on r.id = m.room_id
    where m.id = message_id
      and (r.user_a = auth.uid() or r.user_b = auth.uid())
  )
);
create policy "reactions remove" on message_reactions for delete using (
  user_id = auth.uid()
);

alter publication supabase_realtime add table message_reactions;
