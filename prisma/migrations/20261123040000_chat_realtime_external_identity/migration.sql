BEGIN;
-- Revoke both the previous and new identity when an approval email changes.
CREATE OR REPLACE FUNCTION public.mju_rt_external_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE member_id integer; affected_email text;
BEGIN
  affected_email:=CASE WHEN TG_OP='DELETE' THEN OLD.email ELSE NEW.email END;
  FOR member_id IN
    SELECT u.id FROM public."User" u LEFT JOIN public."ExternalAccessGrant" x ON x.email=lower(btrim(u.email))
    WHERE (lower(btrim(u.email))=lower(btrim(affected_email)) OR (TG_OP='UPDATE' AND lower(btrim(u.email))=lower(btrim(OLD.email)))) AND upper(u.user_type::text) IN ('EXTERNAL_VERIFIED','EXTERNAL_TEST')
      AND (upper(x.status::text)='REVOKED' OR (upper(u.user_type::text)='EXTERNAL_VERIFIED' AND upper(x.status::text) IS DISTINCT FROM 'ACTIVE') OR
        (upper(u.user_type::text)='EXTERNAL_TEST' AND upper(x.status::text) IS DISTINCT FROM 'ACTIVE' AND NOT COALESCE((SELECT google_test_mode_enabled FROM public."AppSettings" WHERE id=1),false))) ORDER BY u.id
  LOOP PERFORM public.mju_revoke_rt_user(member_id); END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
COMMIT;
