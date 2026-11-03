-- Additive. Login approvals and ordinary organization memberships stay intact.
ALTER TABLE "Organization" ADD COLUMN management_campus text;
CREATE TABLE "InstitutionOfficer" (
  user_id integer PRIMARY KEY REFERENCES "User"(id) ON DELETE RESTRICT,
  organization_id integer NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT,
  facility text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true, memo text,
  granted_by_user_id integer NOT NULL, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL
);
CREATE INDEX "InstitutionOfficer_organization_id_active_idx" ON "InstitutionOfficer"(organization_id, active);
CREATE TABLE "InstitutionOfficerAudit" (
  id serial PRIMARY KEY, target_user_id integer, actor_user_id integer NOT NULL,
  action text NOT NULL, before jsonb, after jsonb, reason text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "InstitutionOfficerAudit_target_user_id_created_at_idx" ON "InstitutionOfficerAudit"(target_user_id, created_at);
-- Migrate only explicitly granted existing item-management permissions.
INSERT INTO "Organization" (name, organization_type, scope, management_campus, updated_at)
SELECT DISTINCT g.affiliation, '물품 관리 기관', g.campus, g.campus, CURRENT_TIMESTAMP
FROM "ExternalAccessGrant" g WHERE g.can_manage_items AND g.status::text = 'active'
  AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.name = g.affiliation AND o.management_campus = g.campus);
INSERT INTO "InstitutionOfficer" (user_id, organization_id, facility, active, granted_by_user_id, updated_at)
SELECT u.id, (SELECT min(o.id) FROM "Organization" o WHERE o.name = g.affiliation AND o.management_campus = g.campus),
  g.affiliation, true, g.created_by_user_id, CURRENT_TIMESTAMP
FROM "ExternalAccessGrant" g JOIN "User" u ON lower(u.email) = lower(g.email)
WHERE g.can_manage_items AND g.status::text = 'active' AND u.deleted_at IS NULL AND u.withdrawn_at IS NULL;
INSERT INTO "InstitutionOfficerAudit" (target_user_id, actor_user_id, action, after, reason)
SELECT user_id, granted_by_user_id, 'migrate_explicit_grant', to_jsonb(i), '기존의 명시적 물품 관리 권한 이전' FROM "InstitutionOfficer" i;

ALTER TABLE "FoundPost" ADD COLUMN custody_organization_id integer REFERENCES "Organization"(id) ON DELETE RESTRICT,
  ADD COLUMN pending_transfer_organization_id integer REFERENCES "Organization"(id) ON DELETE RESTRICT;
CREATE INDEX idx_foundpost_custody_org ON "FoundPost"(custody_organization_id, status);
CREATE INDEX idx_foundpost_pending_transfer ON "FoundPost"(pending_transfer_organization_id);
-- Only exact legacy institution/campus matches get a stable ID. Unknowns stay NULL.
UPDATE "FoundPost" p SET custody_organization_id = (
  SELECT min(o.id) FROM "Organization" o WHERE o.name = p.custody->>'institution'
    AND (o.management_campus = p.campus OR o.management_campus = '양쪽')
) WHERE p.custody->>'confirmedAt' IS NOT NULL;
ALTER TABLE "PostStatusChange" ADD COLUMN reason text, ADD COLUMN organization_id integer, ADD COLUMN target_organization_id integer;

ALTER TABLE "AdminVisit" ADD COLUMN activity_audience text;
ALTER TABLE "AdminActivityLog" ADD COLUMN activity_audience text;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['User','LostPost','FoundPost','ChatRoom','Message','PostStatusChange','ActivityDay','AdminVisit','AdminActivityLog'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN activity_role text, ADD COLUMN activity_organization_id integer', t);
  END LOOP;
END $$;
CREATE FUNCTION mju_activity_role(actor_id integer) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN u.is_admin THEN 'service'
    WHEN EXISTS (SELECT 1 FROM "InstitutionOfficer" i JOIN "Organization" o ON o.id=i.organization_id
      WHERE i.user_id=u.id AND i.active AND o.status::text='active' AND o.management_campus IS NOT NULL) THEN 'officer'
    WHEN u.user_type::text='external_test' THEN 'unclassified' ELSE 'member' END FROM "User" u WHERE u.id=actor_id
$$;
CREATE FUNCTION mju_activity_organization(actor_id integer) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT i.organization_id FROM "InstitutionOfficer" i JOIN "Organization" o ON o.id=i.organization_id
  WHERE i.user_id=actor_id AND i.active AND o.status::text='active' AND o.management_campus IS NOT NULL
$$;
CREATE OR REPLACE FUNCTION mju_activity_audience(actor_id integer) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE mju_activity_role(actor_id) WHEN 'service' THEN 'internal' WHEN 'officer' THEN 'internal'
    WHEN 'member' THEN 'member' ELSE 'unclassified' END
$$;
CREATE OR REPLACE FUNCTION mju_stamp_activity_audience() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_id integer;
BEGIN
  IF TG_OP='UPDATE' THEN
    NEW.activity_audience := OLD.activity_audience; NEW.activity_role := OLD.activity_role;
    NEW.activity_organization_id := OLD.activity_organization_id; RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='User' THEN
    NEW.activity_role := CASE WHEN NEW.is_admin THEN 'service' WHEN NEW.user_type::text='external_test' THEN 'unclassified' ELSE 'member' END;
    NEW.activity_audience := CASE NEW.activity_role WHEN 'service' THEN 'internal' WHEN 'member' THEN 'member' ELSE 'unclassified' END;
    NEW.activity_organization_id := NULL; RETURN NEW;
  ELSIF TG_TABLE_NAME IN ('LostPost','FoundPost') THEN actor_id:=NEW.user_id;
  ELSIF TG_TABLE_NAME='Message' THEN actor_id:=NEW.sender_user_id;
  ELSIF TG_TABLE_NAME='ChatRoom' THEN actor_id:=NEW.initiator_user_id;
  ELSIF TG_TABLE_NAME='PostStatusChange' THEN actor_id:=NEW.changed_by_user_id;
  ELSIF TG_TABLE_NAME IN ('AdminVisit','AdminActivityLog') THEN actor_id:=NEW.admin_user_id;
  END IF;
  NEW.activity_role:=mju_activity_role(actor_id); NEW.activity_audience:=mju_activity_audience(actor_id);
  NEW.activity_organization_id:=mju_activity_organization(actor_id); RETURN NEW;
END $$;
CREATE TRIGGER stamp_activity_audience BEFORE INSERT OR UPDATE ON "AdminVisit" FOR EACH ROW EXECUTE FUNCTION mju_stamp_activity_audience();
CREATE TRIGGER stamp_activity_audience BEFORE INSERT OR UPDATE ON "AdminActivityLog" FOR EACH ROW EXECUTE FUNCTION mju_stamp_activity_audience();
INSERT INTO "MetricDaily" (day, metric, value) VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date, 'meta.since.institution_roles', 1) ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW "OperationalMetricDaily" AS
  SELECT day,
    CASE WHEN metric LIKE 'audience_v3.%' THEN substring(metric FROM 13)
      WHEN metric LIKE 'audience_v2.%' THEN CASE
        WHEN substring(metric FROM 13) LIKE '%.internal' OR substring(metric FROM 13) LIKE 'visit.internal.%'
          THEN 'legacy.' || substring(metric FROM 13) ELSE substring(metric FROM 13) END
      ELSE metric END AS metric, value
  FROM "MetricDaily"
  WHERE metric LIKE 'audience_v3.%' OR metric LIKE 'audience_v2.%'
    OR (metric NOT LIKE 'visit.%' AND metric NOT LIKE 'search.%' AND metric NOT LIKE 'recommend.%'
      AND metric NOT LIKE 'active.%' AND metric NOT LIKE 'auth.login.%'
      AND metric NOT IN ('meta.since.user_hourly', 'meta.since.traffic_hourly'))
  UNION ALL
  SELECT day, names.metric, value FROM "MetricDaily"
  CROSS JOIN (VALUES ('meta.since.user_hourly'), ('meta.since.traffic_hourly')) AS names(metric)
  WHERE "MetricDaily".metric = 'meta.since.audience_counters';
