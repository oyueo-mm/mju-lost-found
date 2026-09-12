-- ============================================================================
--  3차: 사진 여러 장 + 알림 실시간
--  Supabase SQL Editor 에 붙여넣고 한 번 실행.
-- ============================================================================

-- 사진 여러 장 (기존 image_url 은 image_urls[0] 으로 유지)
alter table lost_posts  add column if not exists image_urls jsonb;
alter table found_posts add column if not exists image_urls jsonb;

update lost_posts
  set image_urls = jsonb_build_array(image_url)
  where image_url is not null and image_urls is null;
update found_posts
  set image_urls = jsonb_build_array(image_url)
  where image_url is not null and image_urls is null;

-- 알림 실시간
alter publication supabase_realtime add table notifications;
