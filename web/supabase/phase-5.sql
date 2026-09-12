-- ============================================================================
--  5차: 캠퍼스 분리 + 프로필 항목(전공/학번) + 세부위치
--  Supabase SQL Editor 에 붙여넣고 한 번 실행.
-- ============================================================================

-- 게시글 캠퍼스 (humanities = 인문/서울, natural = 자연/용인)
alter table lost_posts  add column if not exists campus text;
alter table found_posts add column if not exists campus text;
alter table lost_posts  add column if not exists location_detail text;
alter table found_posts add column if not exists location_detail text;

-- 기존 게시글은 자연캠퍼스로 지정 (테스트 데이터)
update lost_posts  set campus = 'natural' where campus is null;
update found_posts set campus = 'natural' where campus is null;

-- 프로필: 전공, 학번
alter table profiles add column if not exists major text;
alter table profiles add column if not exists student_id text;

create index if not exists idx_lost_posts_campus  on lost_posts(campus, status, created_at desc);
create index if not exists idx_found_posts_campus on found_posts(campus, status, created_at desc);
