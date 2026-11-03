-- Additive. Wrapped in one transaction: Prisma does not apply a migration atomically.
BEGIN;
-- Per-user admin permissions; User.is_admin stays the full administrator.
CREATE TABLE "AdminPermissionGrant" (
  user_id integer NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  permission text NOT NULL,
  granted_by_user_id integer NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, permission)
);
CREATE INDEX "AdminPermissionGrant_permission_idx" ON "AdminPermissionGrant"(permission);

-- Existing active institution officers keep exactly what they could do:
-- receive, custody, return, transfer. Restoring/correcting stays full-admin-only
-- (no new "items.restore"), and an inactive officer gets nothing.
INSERT INTO "AdminPermissionGrant" (user_id, permission, granted_by_user_id)
SELECT i.user_id, p.permission, i.granted_by_user_id
FROM "InstitutionOfficer" i
CROSS JOIN (VALUES ('items.receive'), ('items.custody'), ('items.return'), ('items.transfer')) AS p(permission)
JOIN "User" u ON u.id = i.user_id
WHERE i.active AND u.deleted_at IS NULL AND u.withdrawn_at IS NULL
ON CONFLICT DO NOTHING;
INSERT INTO "InstitutionOfficerAudit" (target_user_id, actor_user_id, action, after, reason)
SELECT i.user_id, i.granted_by_user_id, 'migrate_to_permissions',
  '{"permissions":["items.receive","items.custody","items.return","items.transfer"]}'::jsonb,
  '기관 담당자 지정을 세부 권한(물품 접수·보관·반환·인계)으로 이전'
FROM "InstitutionOfficer" i JOIN "User" u ON u.id = i.user_id
WHERE i.active AND u.deleted_at IS NULL AND u.withdrawn_at IS NULL;

-- Activity classification: anyone holding at least one permission is a
-- management actor ('officer' keeps its stored value; UI shows it as
-- "관리 권한 보유"). Only NEW events are stamped with it -- history is untouched.
CREATE OR REPLACE FUNCTION mju_activity_role(actor_id integer) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN u.is_admin THEN 'service'
    WHEN EXISTS (SELECT 1 FROM "AdminPermissionGrant" g WHERE g.user_id=u.id) THEN 'officer'
    WHEN u.user_type::text='external_test' THEN 'unclassified' ELSE 'member' END FROM "User" u WHERE u.id=actor_id
$$;
CREATE OR REPLACE FUNCTION mju_activity_organization(actor_id integer) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT i.organization_id FROM "InstitutionOfficer" i JOIN "Organization" o ON o.id=i.organization_id
  WHERE i.user_id=actor_id AND i.active AND o.status::text='active' AND o.management_campus IS NOT NULL
$$;
COMMIT;
