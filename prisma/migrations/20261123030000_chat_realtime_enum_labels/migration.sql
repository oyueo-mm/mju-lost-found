BEGIN;
-- Prisma enum database labels are mapped to lowercase. Normalize labels at
-- this SQL boundary; preserve existing application authorization semantics.
CREATE OR REPLACE FUNCTION public.mju_chat_member_allowed(member_id integer,chat_id integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public."User" u JOIN public."ChatRoom" r ON r.id=chat_id
    LEFT JOIN public."ExternalAccessGrant" x ON x.email=lower(btrim(u.email))
    WHERE u.id=member_id AND u.deleted_at IS NULL
      AND (upper(u.user_type::text) NOT IN ('EXTERNAL_VERIFIED','EXTERNAL_TEST') OR
        (upper(x.status::text) IS DISTINCT FROM 'REVOKED' AND
          (upper(x.status::text)='ACTIVE' OR (upper(u.user_type::text)='EXTERNAL_TEST' AND COALESCE((SELECT google_test_mode_enabled FROM public."AppSettings" WHERE id=1),false)))))
      AND r.initiator_user_id IS NOT NULL
      AND ((r.organization_id IS NULL AND r.counterpart_user_id IS NOT NULL AND member_id IN (r.initiator_user_id,r.counterpart_user_id)) OR
        (r.organization_id IS NOT NULL AND r.counterpart_user_id IS NULL AND (member_id=r.initiator_user_id OR EXISTS(
          SELECT 1 FROM public."OrganizationMember" m WHERE m.organization_id=r.organization_id AND m.user_id=member_id AND upper(m.role::text) IN ('LEADER','ADMIN')
        ))))
  )
$$;
CREATE OR REPLACE FUNCTION public.mju_chat_realtime_receive() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j jsonb; current_epoch numeric;
BEGIN
  j := NULLIF(current_setting('request.jwt.claims',true),'')::jsonb;
  current_epoch := extract(epoch FROM now());
  IF j IS NULL OR j->>'exp' IS NULL OR j->>'iat' IS NULL OR j->>'nbf' IS NULL OR (j->>'exp')::numeric<=(j->>'iat')::numeric OR j->>'role' IS DISTINCT FROM 'mju_chat_realtime' OR j->>'scope' IS DISTINCT FROM 'mju.chat.receive.v1'
     OR j->>'aud' IS DISTINCT FROM 'mju-realtime' OR (j->>'exp')::numeric<=current_epoch
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
CREATE OR REPLACE FUNCTION public.mju_rt_member_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF upper(OLD.role::text) IN ('LEADER','ADMIN') AND
     (TG_OP='DELETE' OR upper(NEW.role::text) NOT IN ('LEADER','ADMIN') OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    PERFORM pg_advisory_xact_lock(184219,OLD.user_id);
    UPDATE public."ChatRealtimeGrant" g SET revoked_at=(now() AT TIME ZONE 'UTC')
    WHERE g.user_id=OLD.user_id AND g.revoked_at IS NULL AND EXISTS(
      SELECT 1 FROM public."ChatRoom" r WHERE r.id=g.room_id AND r.organization_id=OLD.organization_id AND r.initiator_user_id IS DISTINCT FROM OLD.user_id
    );
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.mju_rt_external_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE member_id integer; affected_email text;
BEGIN
  affected_email:=CASE WHEN TG_OP='DELETE' THEN OLD.email ELSE NEW.email END;
  FOR member_id IN
    SELECT u.id FROM public."User" u LEFT JOIN public."ExternalAccessGrant" x ON x.email=lower(btrim(u.email))
    WHERE lower(btrim(u.email))=lower(btrim(affected_email)) AND upper(u.user_type::text) IN ('EXTERNAL_VERIFIED','EXTERNAL_TEST')
      AND (upper(x.status::text)='REVOKED' OR (upper(u.user_type::text)='EXTERNAL_VERIFIED' AND upper(x.status::text) IS DISTINCT FROM 'ACTIVE') OR
        (upper(u.user_type::text)='EXTERNAL_TEST' AND upper(x.status::text) IS DISTINCT FROM 'ACTIVE' AND NOT COALESCE((SELECT google_test_mode_enabled FROM public."AppSettings" WHERE id=1),false))) ORDER BY u.id
  LOOP PERFORM public.mju_revoke_rt_user(member_id); END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.mju_rt_test_mode_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE member_id integer;
BEGIN
  IF TG_OP='UPDATE' AND NEW.google_test_mode_enabled THEN RETURN NEW; END IF;
  FOR member_id IN SELECT u.id FROM public."User" u
    LEFT JOIN public."ExternalAccessGrant" x ON x.email=lower(btrim(u.email))
    WHERE upper(u.user_type::text)='EXTERNAL_TEST' AND upper(x.status::text) IS DISTINCT FROM 'ACTIVE' ORDER BY u.id
  LOOP PERFORM public.mju_revoke_rt_user(member_id); END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
COMMIT;
