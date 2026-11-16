BEGIN;
-- Bind both the requested channel and the authorization probe row to the
-- same grant topic. Other room rows must never inherit this authorization.
-- BEGIN MJU REALTIME REBUILD POLICY
GRANT USAGE ON SCHEMA realtime TO mju_chat_realtime;
GRANT SELECT ON realtime.messages TO mju_chat_realtime;
DROP POLICY IF EXISTS mju_chat_private_receive ON realtime.messages;
CREATE POLICY mju_chat_private_receive ON realtime.messages FOR SELECT TO mju_chat_realtime
USING (topic=realtime.topic() AND extension='broadcast' AND public.mju_chat_realtime_receive());
-- END MJU REALTIME REBUILD POLICY
COMMIT;
