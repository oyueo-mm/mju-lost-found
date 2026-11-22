// Read-only, complete privilege inventory for the Production DB privilege
// cleanup (step 2). BEGIN READ ONLY; catalog only, no data rows. The JSON is
// written to stdout so Preview and Production can be diffed.
//   Preview:    node --env-file=.env.preview.local scripts/operations/db-privilege-inventory.mjs
//   Production: node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/db-privilege-inventory.mjs
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";

if (process.argv.length !== 2) throw new Error("No arguments accepted");
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const db = new Client(pgConfig(process.env.DIRECT_URL, { connectionTimeoutMillis: 15000 }));
const grantee = (col) => `CASE ${col} WHEN 0 THEN 'PUBLIC' ELSE ${col}::regrole::text END`;
const out = { target };
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const q = async (sql) => (await db.query(sql)).rows;
  out.session = (await q(`SELECT current_user, session_user, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser, version()`))[0];
  out.roles = await q(`SELECT rolname, rolsuper, rolinherit, rolcanlogin, rolbypassrls,
      ARRAY(SELECT b.rolname FROM pg_auth_members m JOIN pg_roles b ON b.oid=m.roleid WHERE m.member=r.oid ORDER BY 1) AS member_of
    FROM pg_roles r WHERE rolname IN ('postgres','anon','authenticated','service_role','authenticator','supabase_admin','supabase_storage_admin','supabase_realtime_admin','supabase_auth_admin','pg_database_owner','mju_chat_realtime','dashboard_user','pgbouncer','supabase_replication_admin','supabase_read_only_user') ORDER BY 1`);
  out.publicSchema = (await q(`SELECT nspowner::regrole::text AS owner, nspacl::text AS acl FROM pg_namespace WHERE nspname='public'`))[0];
  out.schemaUsage = await q(`SELECT r AS role, has_schema_privilege(r,'public','USAGE') AS usage, has_schema_privilege(r,'public','CREATE') AS "create"
    FROM unnest(ARRAY['anon','authenticated','service_role','mju_chat_realtime','supabase_storage_admin','supabase_realtime_admin','supabase_auth_admin','authenticator','postgres']) r WHERE EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r)`);
  out.relations = await q(`SELECT c.relkind AS kind, c.relowner::regrole::text AS owner, count(*)::int AS n FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m','S','f') GROUP BY 1,2 ORDER BY 1,2`);
  out.relationAclEntries = await q(`SELECT c.relkind AS kind, ${grantee("a.grantee")} AS grantee, a.privilege_type AS privilege, count(*)::int AS relations
    FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault((CASE WHEN c.relkind='S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a
    WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m','S','f') AND a.grantee<>c.relowner
    GROUP BY 1,2,3 ORDER BY 1,2,3`);
  out.cleanRelations = await q(`SELECT c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r',c.relowner))) a WHERE a.grantee IN (0,'anon'::regrole,'authenticated'::regrole)) ORDER BY 1`);
  out.columnPrivileges = (await q(`SELECT count(*)::int AS n FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='public'::regnamespace AND a.attacl IS NOT NULL`))[0].n;
  out.functions = await q(`SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args, p.proowner::regrole::text AS owner, p.prosecdef AS security_definer,
      p.prorettype='trigger'::regtype AS is_trigger, coalesce(array_to_string(p.proconfig, ','), '') AS config,
      ARRAY(SELECT ${grantee("a.grantee")} FROM aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner ORDER BY 1) AS execute_grantees,
      (SELECT count(*)::int FROM pg_trigger t WHERE t.tgfoid=p.oid AND NOT t.tgisinternal) AS used_by_triggers,
      (SELECT count(*)::int FROM pg_policy pol WHERE pg_get_expr(pol.polqual, pol.polrelid) LIKE '%'||p.proname||'%' OR pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%'||p.proname||'%') AS used_by_policies,
      (SELECT count(*)::int FROM pg_constraint k WHERE pg_get_constraintdef(k.oid) LIKE '%'||p.proname||'%') AS used_by_constraints
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace ORDER BY 1,2`);
  out.policiesUsingPublic = await q(`SELECT n.nspname AS schema, c.relname AS "table", pol.polname AS policy, ARRAY(SELECT CASE r WHEN 0 THEN 'PUBLIC' ELSE r::regrole::text END FROM unnest(pol.polroles) r) AS roles
    FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace ORDER BY 1,2,3`);
  out.triggers = (await q(`SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal`))[0].n;
  out.defaultAcls = await q(`SELECT defaclrole::regrole::text AS owner, coalesce(defaclnamespace::regnamespace::text,'(global)') AS schema, defaclobjtype AS type, defaclacl::text AS acl FROM pg_default_acl ORDER BY 2,1,3`);
  out.extensionsInPublic = await q(`SELECT e.extname, e.extowner::regrole::text AS owner FROM pg_extension e WHERE e.extnamespace='public'::regnamespace ORDER BY 1`);
  out.publications = await q(`SELECT pubname, puballtables FROM pg_publication ORDER BY 1`);
  out.cronSchema = (await q(`SELECT to_regnamespace('cron') IS NOT NULL AS pg_cron`))[0].pg_cron;
  await db.query("ROLLBACK");
} finally {
  await db.end().catch(() => {});
}
console.log(JSON.stringify(out, null, 1));
