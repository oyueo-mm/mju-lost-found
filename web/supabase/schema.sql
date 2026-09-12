-- ============================================================================
--  명지 스마트 분실물 센터 — Supabase(Postgres) 스키마
--  기존 SQLite 스키마(db/schema.sql, 파이썬 버전)를 Postgres + pgvector로 옮긴 것.
--  Supabase 대시보드 > SQL Editor 에 그대로 붙여넣어 실행.
-- ============================================================================

-- pgvector 확장 (AI 매칭 임베딩 저장/검색용)
create extension if not exists vector;


-- ----------------------------------------------------------------------------
--  profiles : 사용자 프로필
--  로그인 계정 자체는 Supabase가 auth.users 에 관리하고, 여기엔 앱에서 쓰는
--  공개 정보(닉네임 등)와 권한(관리자/정지)만 둔다. id = auth.users.id
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null,
  name            text not null default '',
  nickname        text unique,
  is_admin        boolean not null default false,
  is_suspended    boolean not null default false,
  suspended_until timestamptz,
  created_at      timestamptz not null default now()
);

-- 닉네임 규칙: 한글/영문/숫자 2~20자 (파이썬 _NICKNAME_RE 와 동일)
alter table profiles drop constraint if exists profiles_nickname_format;
alter table profiles add constraint profiles_nickname_format
  check (nickname is null or nickname ~ '^[가-힣a-zA-Z0-9]{2,20}$');


-- ----------------------------------------------------------------------------
--  lost_posts / found_posts : 찾아요(분실) / 찾았어요(습득) 게시판
--  embedding 은 게시글 등록·수정 시 1번 계산해서 저장 → 검색 때 재사용.
--  vector(1024) = Cloudflare bge-m3 차원. 로컬 MiniLM 으로 바꾸면 384 로.
-- ----------------------------------------------------------------------------
create table if not exists lost_posts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  title       text not null,
  description text not null,
  category    text not null,
  location    text not null,
  lost_at     timestamptz not null,
  status      text not null default '찾는 중' check (status in ('찾는 중', '찾음')),
  image_url   text,
  embedding   vector(1024),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists found_posts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  title       text not null,
  description text not null,
  category    text not null,
  location    text not null,
  found_at    timestamptz not null,
  status      text not null default '보관 중' check (status in ('보관 중', '완료')),
  image_url   text,
  embedding   vector(1024),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_lost_posts_user   on lost_posts(user_id);
create index if not exists idx_found_posts_user  on found_posts(user_id);
create index if not exists idx_lost_posts_created  on lost_posts(created_at desc);
create index if not exists idx_found_posts_created on found_posts(created_at desc);

-- 벡터 유사도 인덱스 (코사인). 데이터가 쌓이면 효과가 커진다.
create index if not exists idx_lost_posts_embedding
  on lost_posts using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists idx_found_posts_embedding
  on found_posts using ivfflat (embedding vector_cosine_ops) with (lists = 100);


-- ----------------------------------------------------------------------------
--  matches : 확정된 매칭 (분실 게시글 <-> 습득 게시글)
-- ----------------------------------------------------------------------------
create table if not exists matches (
  id            bigint generated always as identity primary key,
  lost_post_id  bigint not null references lost_posts(id) on delete cascade,
  found_post_id bigint not null references found_posts(id) on delete cascade,
  score         real not null,
  created_at    timestamptz not null default now(),
  unique (lost_post_id, found_post_id)
);
create index if not exists idx_matches_lost  on matches(lost_post_id);
create index if not exists idx_matches_found on matches(found_post_id);


-- ============================================================================
--  아래는 2차(채팅/알림/신고/관리자) — MVP 이후. 지금 실행해도 무방.
-- ============================================================================

create table if not exists chat_rooms (
  id                   bigint generated always as identity primary key,
  match_id             bigint unique references matches(id) on delete cascade,
  direct_lost_post_id  bigint references lost_posts(id) on delete cascade,
  direct_found_post_id bigint references found_posts(id) on delete cascade,
  initiator_user_id    uuid references profiles(id),
  created_at           timestamptz not null default now()
);

create table if not exists messages (
  id                bigint generated always as identity primary key,
  chat_room_id      bigint not null references chat_rooms(id) on delete cascade,
  sender_user_id    uuid not null references profiles(id),
  content           text not null,
  created_at        timestamptz not null default now(),
  read_at           timestamptz,
  hidden_at         timestamptz,
  hidden_by_user_id uuid references profiles(id),
  hidden_reason     text
);
create index if not exists idx_messages_room on messages(chat_room_id, created_at desc, id desc);

create table if not exists reports (
  id                   bigint generated always as identity primary key,
  reporter_user_id     uuid not null references profiles(id),
  target_type          text not null check (target_type in ('post', 'message', 'user')),
  target_id            text not null,
  reason               text not null,
  detail               text,
  status               text not null default 'pending' check (status in ('pending', 'dismissed', 'actioned')),
  processed_at         timestamptz,
  processed_by_user_id uuid references profiles(id),
  admin_note           text,
  created_at           timestamptz not null default now(),
  unique (reporter_user_id, target_type, target_id)
);

create table if not exists notifications (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references profiles(id) on delete cascade,
  type         text not null check (type in ('message','match','report_processed','post_deleted','message_hidden','user_suspended')),
  title        text not null,
  content      text not null,
  related_type text,
  related_id   text,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (user_id, type, related_type, related_id)
);
create index if not exists idx_notifications_user on notifications(user_id, is_read, created_at desc);


-- ============================================================================
--  RLS (Row Level Security) — 누가 어떤 행을 읽고/쓸 수 있는지.
--  파이썬 버전의 db.py 안 권한 체크들을 DB 레벨로 옮긴 것.
-- ============================================================================
alter table profiles     enable row level security;
alter table lost_posts   enable row level security;
alter table found_posts  enable row level security;
alter table matches      enable row level security;

-- profiles: 로그인한 사람은 모든 프로필의 공개 정보를 볼 수 있고, 자기 것만 수정.
create policy "profiles read"        on profiles for select using (auth.role() = 'authenticated');
create policy "profiles update self" on profiles for update using (auth.uid() = id);
create policy "profiles insert self" on profiles for insert with check (auth.uid() = id);

-- 게시판: 로그인한 사람은 다 읽음. 쓰기/수정/삭제는 작성자 본인만.
create policy "lost read"   on lost_posts  for select using (auth.role() = 'authenticated');
create policy "lost insert" on lost_posts  for insert with check (auth.uid() = user_id);
create policy "lost update" on lost_posts  for update using (auth.uid() = user_id);
create policy "lost delete" on lost_posts  for delete using (auth.uid() = user_id);

create policy "found read"   on found_posts for select using (auth.role() = 'authenticated');
create policy "found insert" on found_posts for insert with check (auth.uid() = user_id);
create policy "found update" on found_posts for update using (auth.uid() = user_id);
create policy "found delete" on found_posts for delete using (auth.uid() = user_id);

-- 매칭: 로그인한 사람은 읽기. 생성/삭제는 서버(service_role)에서만 → 정책 없음(기본 거부).
create policy "matches read" on matches for select using (auth.role() = 'authenticated');
