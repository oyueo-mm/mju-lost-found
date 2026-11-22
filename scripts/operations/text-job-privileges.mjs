// Function Storage C-2: read-only check of the TextEmbeddingJob protection.
// Runs inside BEGIN READ ONLY; the role probes use SET LOCAL ROLE inside that
// transaction only (no session-level setting) and are rolled back. Prints no data rows.
//   Preview:    node --env-file=.env.preview.local scripts/operations/text-job-privileges.mjs
//   Production: node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/text-job-privileges.mjs
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";

if (process.argv.length !== 2) throw new Error("No arguments accepted");
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const db = new Client(pgConfig(process.env.DIRECT_URL, { connectionTimeoutMillis: 15000 }));
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) }); };
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const exists = (await db.query(`SELECT to_regclass('public."TextEmbeddingJob"') IS NOT NULL AS t`)).rows[0].t;
  check("table exists", exists);
  if (exists) {
    const rel = (await db.query(`SELECT relrowsecurity,relforcerowsecurity,relowner::regrole::text AS owner FROM pg_class WHERE oid='public."TextEmbeddingJob"'::regclass`)).rows[0];
    check("RLS enabled", rel.relrowsecurity === true, { owner: rel.owner });
    check("no policies", (await db.query(`SELECT count(*)::int n FROM pg_policies WHERE schemaname='public' AND tablename='TextEmbeddingJob'`)).rows[0].n === 0);
    const leaks = (await db.query(`SELECT r AS role,p AS privilege FROM unnest(ARRAY['anon','authenticated']) r, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
      WHERE EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) AND has_table_privilege(r,'public."TextEmbeddingJob"',p)`)).rows;
    check("anon/authenticated have no table privilege", leaks.length === 0, leaks);
    const acl = (await db.query(`SELECT CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,a.privilege_type FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid='public."TextEmbeddingJob"'::regclass AND a.grantee<>c.relowner ORDER BY 1,2`)).rows;
    check("table ACL has no client or PUBLIC entry", !acl.some((e) => ["PUBLIC", "anon", "authenticated"].includes(e.grantee)), acl);
    // Only the owner (the app's migrating/runtime role) may hold privileges:
    // nothing inherited from a default ACL, service_role included. The one
    // exception is the read-only cloud backup role (2026-11-22), and only its
    // SELECT -- any other entry still fails this check.
    const others = acl.filter((e) => !(e.grantee === "backup_reader" && e.privilege_type === "SELECT"));
    check("no inherited privilege for any non-owner role (backup_reader SELECT excepted)", others.length === 0, acl);
    const fn = (await db.query(`SELECT r FROM unnest(ARRAY['anon','authenticated']) r WHERE EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) AND has_function_privilege(r,'public.queue_text_embedding()','EXECUTE')`)).rows;
    const fnAcl = (await db.query(`SELECT CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a WHERE p.oid='public.queue_text_embedding()'::regprocedure AND a.grantee<>p.proowner`)).rows;
    check("trigger function not executable by clients or PUBLIC", fn.length === 0 && !fnAcl.some((e) => ["PUBLIC", "anon", "authenticated"].includes(e.grantee)), fnAcl);
    check("four triggers", (await db.query(`SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('lost_text_embedding_job','found_text_embedding_job','lost_text_embedding_job_cleanup','found_text_embedding_job_cleanup')`)).rows[0].n === 4);
    for (const role of ["anon", "authenticated"]) {
      if (!(await db.query(`SELECT 1 FROM pg_roles WHERE rolname=$1`, [role])).rowCount) continue;
      await db.query("SAVEPOINT probe");
      let denied = false;
      try { await db.query(`SET LOCAL ROLE ${role}`); await db.query(`SELECT 1 FROM public."TextEmbeddingJob" LIMIT 1`); }
      catch (error) { denied = error.code === "42501"; }
      await db.query("ROLLBACK TO SAVEPOINT probe");
      check(`${role} read is denied`, denied);
    }
    const queue = (await db.query(`SELECT state,count(*)::int AS jobs,max(attempts)::int AS max_attempts FROM public."TextEmbeddingJob" GROUP BY state ORDER BY state`)).rows;
    check("queue summary", true, queue);
  }
  const defaults = (await db.query(`SELECT defaclobjtype AS type,defaclacl::text AS acl FROM pg_default_acl WHERE defaclnamespace='public'::regnamespace`)).rows;
  check("public default ACLs (informational)", true, defaults);
  await db.query("ROLLBACK");
} finally {
  await db.end().catch(() => {});
}
const passed = checks.every((c) => c.ok);
console.log(JSON.stringify({ target, passed, checks }, null, 1));
if (!passed) process.exitCode = 1;
