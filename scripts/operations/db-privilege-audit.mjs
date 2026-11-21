// Read-only audit of client-role privileges in the public schema (the residual
// Production grants found on 2026-11-12). BEGIN READ ONLY; counts and names of
// privilege kinds only, no data. Compare Preview and Production runs.
//   Preview:    node --env-file=.env.preview.local scripts/operations/db-privilege-audit.mjs
//   Production: node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/db-privilege-audit.mjs
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

if (process.argv.length !== 2) throw new Error("No arguments accepted");
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const db = new Client({ connectionString: process.env.DIRECT_URL, connectionTimeoutMillis: 15000 });
const out = { target, at: new Date().toISOString() };
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const q = async (sql) => (await db.query(sql)).rows;
  out.tables = (await q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE c.relrowsecurity)::int AS rls_on FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'`))[0];
  out.schemaUsage = await q(`SELECT r AS role, has_schema_privilege(r,'public','USAGE') AS usage, has_schema_privilege(r,'public','CREATE') AS "create" FROM unnest(ARRAY['anon','authenticated']) r WHERE EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r)`);
  out.tablePrivileges = await q(`SELECT r AS role, p AS privilege, count(*)::int AS tables
    FROM pg_class c, unnest(ARRAY['anon','authenticated']) r, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
    WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) AND has_table_privilege(r,c.oid,p)
    GROUP BY 1,2 ORDER BY 1,2`);
  out.functionsExecutableByAnon = (await q(`SELECT count(*)::int AS n FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') AND has_function_privilege('anon',p.oid,'EXECUTE')`))[0].n;
  out.defaultAcls = await q(`SELECT defaclrole::regrole::text AS owner, defaclobjtype AS type, defaclacl::text AS acl FROM pg_default_acl WHERE defaclnamespace='public'::regnamespace ORDER BY 1,2`);
  out.cleanNewTables = await q(`SELECT c.relname AS "table", NOT EXISTS(SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee<>c.relowner) AS owner_only FROM pg_class c WHERE c.oid IN (to_regclass('public."TextEmbeddingJob"'))`);
  await db.query("ROLLBACK");
} finally {
  await db.end().catch(() => {});
}
console.log(JSON.stringify(out, null, 1));
