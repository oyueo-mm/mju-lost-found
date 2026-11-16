BEGIN;
CREATE TABLE public."ChatRealtimeSession" (
  id uuid PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  expires_at timestamp(3) NOT NULL,
  revoked_at timestamp(3),
  created_at timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  UNIQUE(id,user_id)
);
CREATE TABLE public."ChatRealtimeGrant" (
  id uuid PRIMARY KEY,
  user_id integer NOT NULL,
  session_id uuid NOT NULL,
  room_id integer NOT NULL REFERENCES public."ChatRoom"(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  expires_at timestamp(3) NOT NULL,
  revoked_at timestamp(3),
  created_at timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  FOREIGN KEY(session_id,user_id) REFERENCES public."ChatRealtimeSession"(id,user_id) ON DELETE CASCADE,
  UNIQUE(session_id,room_id,client_id)
);
CREATE INDEX "ChatRealtimeGrant_active_room" ON public."ChatRealtimeGrant"(room_id,expires_at) WHERE revoked_at IS NULL;
CREATE TABLE public."ChatRealtimeConfig" (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  mode text NOT NULL DEFAULT 'polling' CHECK(mode IN ('polling','private')),
  project_ref text,
  signing_kid uuid
);
INSERT INTO public."ChatRealtimeConfig"(id) VALUES(true);
ALTER TABLE public."ChatRealtimeSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChatRealtimeGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChatRealtimeConfig" ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.mju_chat_member_allowed(member_id integer,chat_id integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public."User" u JOIN public."ChatRoom" r ON r.id=chat_id
    LEFT JOIN public."ExternalAccessGrant" x ON x.email=lower(btrim(u.email))
    WHERE u.id=member_id AND u.deleted_at IS NULL
      AND (u.user_type::text NOT IN ('EXTERNAL_VERIFIED','EXTERNAL_TEST') OR
        (x.status::text IS DISTINCT FROM 'REVOKED' AND
          (x.status::text='ACTIVE' OR (u.user_type::text='EXTERNAL_TEST' AND COALESCE((SELECT google_test_mode_enabled FROM public."AppSettings" WHERE id=1),false)))))
      AND r.initiator_user_id IS NOT NULL
      AND ((r.organization_id IS NULL AND r.counterpart_user_id IS NOT NULL AND member_id IN (r.initiator_user_id,r.counterpart_user_id)) OR
        (r.organization_id IS NOT NULL AND r.counterpart_user_id IS NULL AND (member_id=r.initiator_user_id OR EXISTS(
          SELECT 1 FROM public."OrganizationMember" m WHERE m.organization_id=r.organization_id AND m.user_id=member_id AND m.role::text IN ('LEADER','ADMIN')
        ))))
  )
$$;

CREATE FUNCTION public.mju_chat_realtime_receive() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j jsonb; current_epoch numeric;
BEGIN
  j := NULLIF(current_setting('request.jwt.claims',true),'')::jsonb;
  current_epoch := extract(epoch FROM now());
  IF j IS NULL OR j->>'role'<>'mju_chat_realtime' OR j->>'scope'<>'mju.chat.receive.v1'
     OR j->>'aud'<>'mju-realtime' OR (j->>'exp')::numeric<=current_epoch
     OR (j->>'exp')::numeric-(j->>'iat')::numeric>120
     OR (j->>'iat')::numeric>current_epoch+5 OR (j->>'nbf')::numeric>current_epoch THEN RETURN false; END IF;
  RETURN EXISTS(
    SELECT 1 FROM public."ChatRealtimeGrant" g
    JOIN public."ChatRealtimeSession" s ON s.id=g.session_id AND s.user_id=g.user_id
    JOIN public."ChatRealtimeConfig" c ON c.id=true
    WHERE g.id=(j->>'grant_id')::uuid AND g.id::text=j->>'sub'
      AND g.user_id=(j->>'app_user_id')::integer AND g.room_id=(j->>'room_id')::integer
      AND s.id=(j->>'auth_sid')::uuid
      AND g.revoked_at IS NULL AND s.revoked_at IS NULL
      AND g.expires_at>(now() AT TIME ZONE 'UTC') AND s.expires_at>(now() AT TIME ZONE 'UTC')
      AND c.mode='private' AND c.project_ref=j->>'project'
      AND j->>'iss'='https://'||c.project_ref||'.supabase.co/auth/v1'
      AND realtime.topic()='mju-chat:'||g.id::text
      AND public.mju_chat_member_allowed(g.user_id,g.room_id)
  );
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

-- BEGIN MJU REALTIME REBUILD PUBLIC ACL
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
-- END MJU REALTIME REBUILD PUBLIC ACL
COMMIT;
