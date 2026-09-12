-- ============================================================================
--  4차: 댓글
--  Supabase SQL Editor 에 붙여넣고 한 번 실행.
-- ============================================================================

create table if not exists comments (
  id         bigint generated always as identity primary key,
  post_type  text not null check (post_type in ('lost', 'found')),
  post_id    bigint not null,
  user_id    uuid not null references profiles(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_comments_post
  on comments(post_type, post_id, created_at);

alter table comments enable row level security;

create policy "comments read"   on comments for select using (auth.role() = 'authenticated');
create policy "comments insert" on comments for insert with check (user_id = auth.uid());
create policy "comments delete" on comments for delete using (user_id = auth.uid());
