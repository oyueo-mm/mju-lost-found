// Function Storage C-2: read-only preflight before applying
// 20261124000000_text_embedding_jobs. BEGIN READ ONLY; prints names/counts only.
//   node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/c2-preflight.mjs
import "../db/install-guard.mjs";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";

if (process.argv.length !== 2) throw new Error("No arguments accepted");
const NEW = "20261124000000_text_embedding_jobs";
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const local = readdirSync("prisma/migrations", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sums = (name) => { const raw = readFileSync(`prisma/migrations/${name}/migration.sql`); return [createHash("sha256").update(raw).digest("hex"), createHash("sha256").update(raw.toString("utf8").replaceAll("\r\n", "\n")).digest("hex")]; };
const db = new Client(pgConfig(process.env.DIRECT_URL, { connectionTimeoutMillis: 15000 }));
const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const all = (await db.query(`SELECT migration_name,checksum,to_char(started_at,'YYYY-MM-DD"T"HH24:MI:SS') AS started,finished_at IS NOT NULL AS applied,rolled_back_at IS NOT NULL AS rolled_back,applied_steps_count AS steps FROM _prisma_migrations ORDER BY started_at`)).rows;
  // Prisma's own rule: a row that neither finished nor was marked rolled back
  // blocks migrate deploy. A rolled-back row is history when the same
  // migration was later applied (the documented non-atomic recovery).
  const failed = all.filter((r) => !r.applied && !r.rolled_back);
  check("no failed (unresolved) migration rows", failed.length === 0, failed);
  const history = all.filter((r) => r.applied && !r.rolled_back);
  const rolledBack = all.filter((r) => r.rolled_back);
  check("rolled-back rows were each re-applied later (history only)", rolledBack.every((r) => history.some((h) => h.migration_name === r.migration_name && h.started > r.started)), rolledBack);
  const appliedNames = new Set(history.map((r) => r.migration_name));
  const pending = local.filter((n) => !appliedNames.has(n));
  check("only the C-2 migration is pending", pending.length === 1 && pending[0] === NEW, pending);
  check("no applied migration missing locally", history.every((r) => local.includes(r.migration_name)), history.filter((r) => !local.includes(r.migration_name)).map((r) => r.migration_name));
  const mismatched = history.filter((r) => local.includes(r.migration_name) && !sums(r.migration_name).includes(r.checksum)).map((r) => r.migration_name);
  check("applied migration checksums match local files", mismatched.length === 0, mismatched);
  const taken = (await db.query(`SELECT 'table' AS kind FROM pg_class WHERE oid=to_regclass('public."TextEmbeddingJob"')
    UNION ALL SELECT 'function' FROM pg_proc WHERE proname='queue_text_embedding'
    UNION ALL SELECT 'trigger:'||tgname FROM pg_trigger WHERE tgname LIKE '%text_embedding_job%'
    UNION ALL SELECT 'index' FROM pg_class WHERE relname='TextEmbeddingJob_pending'`)).rows.map((r) => r.kind);
  check("new object names are free", taken.length === 0, taken);
  const cols = (await db.query(`SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('LostPost','FoundPost') AND column_name IN ('id','title','description','category','location','embedding') ORDER BY 1,2`)).rows;
  check("post tables have the trigger columns", cols.length === 12, cols.map((c) => `${c.table_name}.${c.column_name}:${c.data_type}`));
  const roles = (await db.query(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') ORDER BY 1`)).rows.map((r) => r.rolname);
  check("client roles present (REVOKE targets)", roles.includes("anon") && roles.includes("authenticated"), roles);
  const defaults = (await db.query(`SELECT defaclrole::regrole::text AS owner,defaclobjtype AS type,defaclacl::text AS acl FROM pg_default_acl WHERE defaclnamespace='public'::regnamespace ORDER BY 1,2`)).rows;
  check("public default ACLs (informational: new tables inherit these)", true, defaults);
  const who = (await db.query(`SELECT current_user AS u`)).rows[0].u;
  check("migrating role (informational)", true, who);
  const posts = (await db.query(`SELECT (SELECT count(*)::int FROM "LostPost") AS lost,(SELECT count(*)::int FROM "FoundPost") AS found`)).rows[0];
  check("post counts (informational)", true, posts);
  await db.query("ROLLBACK");
} finally {
  await db.end().catch(() => {});
}
const passed = checks.every((c) => c.ok);
console.log(JSON.stringify({ target, passed, checks }, null, 1));
if (!passed) process.exitCode = 1;
