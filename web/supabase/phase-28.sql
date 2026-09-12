-- ============================================================================
--  28차: 실시간(realtime) 대상 테이블 추가
--  DealBar / RealtimeRefresher / InquiryRealtime 구독이 동작하려면
--  해당 테이블이 supabase_realtime publication 에 있어야 한다.
--  (notifications, messages 는 이미 추가돼 있음)
-- ============================================================================

alter publication supabase_realtime add table chat_rooms;
alter publication supabase_realtime add table reports;
alter publication supabase_realtime add table inquiries;
alter publication supabase_realtime add table inquiry_messages;

-- 이미 추가돼 있으면 "already member" 에러가 나는데 무시하면 됨.
-- 개별로 확인: select * from pg_publication_tables where pubname='supabase_realtime';

-- 끝.
