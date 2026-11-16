-- D3 scoped authorization rebuild. Keep synchronized with migration ACL blocks.

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mju_chat_realtime') THEN
    CREATE ROLE mju_chat_realtime NOLOGIN NOINHERIT NOBYPASSRLS;
  ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mju_chat_realtime' AND (rolcanlogin OR rolinherit OR rolbypassrls OR rolsuper OR rolcreaterole OR rolcreatedb)) THEN
    RAISE EXCEPTION 'Unexpected existing Realtime role privileges';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.mju_chat_member_allowed(integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mju_chat_realtime_receive() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mju_chat_realtime_receive() TO mju_chat_realtime;


GRANT USAGE ON SCHEMA realtime TO mju_chat_realtime;
GRANT SELECT ON realtime.messages TO mju_chat_realtime;
DROP POLICY IF EXISTS mju_chat_private_receive ON realtime.messages;
CREATE POLICY mju_chat_private_receive ON realtime.messages FOR SELECT TO mju_chat_realtime
USING (topic=realtime.topic() AND extension='broadcast' AND public.mju_chat_realtime_receive());


REVOKE ALL ON FUNCTION public.mju_revoke_rt_user(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mju_rt_user_changed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mju_rt_member_changed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mju_rt_external_changed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mju_rt_test_mode_changed() FROM PUBLIC;
