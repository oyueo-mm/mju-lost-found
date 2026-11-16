BEGIN;
CREATE FUNCTION public.mju_revoke_rt_user(member_id integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(184219,member_id);
  UPDATE public."ChatRealtimeSession" SET revoked_at=(now() AT TIME ZONE 'UTC') WHERE user_id=member_id AND revoked_at IS NULL;
  UPDATE public."ChatRealtimeGrant" SET revoked_at=(now() AT TIME ZONE 'UTC') WHERE user_id=member_id AND revoked_at IS NULL;
END $$;

CREATE FUNCTION public.mju_rt_user_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN PERFORM public.mju_revoke_rt_user(NEW.id); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mju_rt_user_revoke AFTER UPDATE OF deleted_at ON public."User" FOR EACH ROW EXECUTE FUNCTION public.mju_rt_user_changed();

CREATE FUNCTION public.mju_rt_member_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.role::text IN ('LEADER','ADMIN') AND
     (TG_OP='DELETE' OR NEW.role::text NOT IN ('LEADER','ADMIN') OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    PERFORM pg_advisory_xact_lock(184219,OLD.user_id);
    UPDATE public."ChatRealtimeGrant" g SET revoked_at=(now() AT TIME ZONE 'UTC')
    WHERE g.user_id=OLD.user_id AND g.revoked_at IS NULL AND EXISTS(
      SELECT 1 FROM public."ChatRoom" r WHERE r.id=g.room_id AND r.organization_id=OLD.organization_id AND r.initiator_user_id IS DISTINCT FROM OLD.user_id
    );
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER mju_rt_member_revoke AFTER UPDATE OR DELETE ON public."OrganizationMember" FOR EACH ROW EXECUTE FUNCTION public.mju_rt_member_changed();

CREATE FUNCTION public.mju_rt_external_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE member_id integer; affected_email text;
BEGIN
  affected_email:=CASE WHEN TG_OP='DELETE' THEN OLD.email ELSE NEW.email END;
  FOR member_id IN
    SELECT u.id FROM public."User" u LEFT JOIN public."ExternalAccessGrant" x ON x.email=lower(btrim(u.email))
    WHERE lower(btrim(u.email))=lower(btrim(affected_email)) AND u.user_type::text IN ('EXTERNAL_VERIFIED','EXTERNAL_TEST')
      AND (x.status::text='REVOKED' OR (u.user_type::text='EXTERNAL_VERIFIED' AND x.status::text IS DISTINCT FROM 'ACTIVE') OR
        (u.user_type::text='EXTERNAL_TEST' AND x.status::text IS DISTINCT FROM 'ACTIVE' AND NOT COALESCE((SELECT google_test_mode_enabled FROM public."AppSettings" WHERE id=1),false))) ORDER BY u.id
  LOOP PERFORM public.mju_revoke_rt_user(member_id); END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER mju_rt_external_revoke AFTER UPDATE OR DELETE ON public."ExternalAccessGrant" FOR EACH ROW EXECUTE FUNCTION public.mju_rt_external_changed();

CREATE FUNCTION public.mju_rt_test_mode_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE member_id integer;
BEGIN
  IF TG_OP='UPDATE' AND NEW.google_test_mode_enabled THEN RETURN NEW; END IF;
  FOR member_id IN SELECT u.id FROM public."User" u
    LEFT JOIN public."ExternalAccessGrant" x ON x.email=lower(btrim(u.email))
    WHERE u.user_type::text='EXTERNAL_TEST' AND x.status::text IS DISTINCT FROM 'ACTIVE' ORDER BY u.id
  LOOP PERFORM public.mju_revoke_rt_user(member_id); END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER mju_rt_test_mode_revoke AFTER UPDATE OF google_test_mode_enabled OR DELETE ON public."AppSettings" FOR EACH ROW EXECUTE FUNCTION public.mju_rt_test_mode_changed();

-- BEGIN MJU REALTIME REBUILD REVOCATION ACL
REVOKE ALL ON FUNCTION public.mju_revoke_rt_user(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mju_rt_user_changed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mju_rt_member_changed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mju_rt_external_changed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mju_rt_test_mode_changed() FROM PUBLIC;
-- END MJU REALTIME REBUILD REVOCATION ACL
COMMIT;
