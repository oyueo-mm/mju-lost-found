// Read-only preflight for the cloud backup role (backup_reader). Answers, for
// the connected database (Preview, or Production through the approved
// launcher):
//   - can the owner role create it (BYPASSRLS, CREATEROLE, grant options)?
//   - does it already exist, and with which attributes/settings?
//   - which SECURITY DEFINER functions in the schemas it would see (public,
//     storage, realtime) are executable by PUBLIC (or by backup_reader) --
//     the only way a read-only role could still cause a write is calling one
//     of those after turning its read-only default off;
//   - which default privileges postgres has in public (new-table inheritance);
//   - how many public tables use RLS, have triggers, and how many exist.
// Counts, names of functions/schemas and flags only; no row data.
//   node --env-file=.env.preview.local scripts/operations/backup-reader-preflight.mjs
//   node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/backup-reader-preflight.mjs
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const db = new Client({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  await db.query("BEGIN READ ONLY");
  const q = async (sql) => (await db.query(sql)).rows;
  const role = (await q(`SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolinherit, rolreplication, rolbypassrls, rolconnlimit, rolconfig FROM pg_roles WHERE rolname='backup_reader'`))[0] ?? null;
  const who = role ? "backup_reader" : "public";
  const owner = (await q(`SELECT current_user AS name, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname=current_user`))[0];
  const grantOptions = (await q(`SELECT has_table_privilege('storage.objects','SELECT WITH GRANT OPTION') AS objects, has_table_privilege('storage.buckets','SELECT WITH GRANT OPTION') AS buckets`))[0];
  const definers = await q(`
    SELECT n.nspname AS schema, p.proname AS name
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.prosecdef AND n.nspname IN ('public','storage','realtime')
       AND ${role ? "has_function_privilege('backup_reader', p.oid, 'EXECUTE')" : "EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')"}
     ORDER BY 1, 2`);
  const defaults = await q(`SELECT pg_get_userbyid(d.defaclrole) AS owner, n.nspname AS schema, d.defaclobjtype AS type, d.defaclacl::text AS acl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace WHERE n.nspname = 'public' OR d.defaclnamespace = 0 ORDER BY 1, 2, 3`);
  const tables = (await q(`SELECT count(*)::int AS tables, count(*) FILTER (WHERE c.relrowsecurity)::int AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')`))[0];
  const triggers = (await q(`SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal`))[0].n;
  const readerTables = role ? (await q(`SELECT count(*) FILTER (WHERE has_table_privilege('backup_reader', c.oid, 'SELECT'))::int AS select, count(*) FILTER (WHERE has_table_privilege('backup_reader', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE'))::int AS write FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')`))[0] : null;
  const readerOther = role ? (await q(`SELECT n.nspname AS schema, has_schema_privilege('backup_reader', n.oid, 'USAGE') AS usage FROM pg_namespace n WHERE n.nspname IN ('auth','vault','extensions','graphql','pgsodium','supabase_functions','net','cron','storage','realtime','public') ORDER BY 1`)) : null;
  await db.query("ROLLBACK");
  console.log(JSON.stringify({ target, owner, grantOptions, backupReader: role, checkedFor: who, executableSecurityDefinerFunctions: definers, publicDefaultPrivileges: defaults, publicTables: tables, publicTriggers: triggers, readerTables, readerSchemaUsage: readerOther }, null, 1));
} finally {
  await db.end();
}
