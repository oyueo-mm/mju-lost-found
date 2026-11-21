// Read-only proof that client roles are actually refused in schema public
// (DB privilege step 2). Everything runs inside ONE `BEGIN READ ONLY`
// transaction that is always rolled back; roles are switched only with
// SET LOCAL ROLE (transaction scope, never a session setting). Each attempt runs
// in its own savepoint, and the role is checked again after each rollback.
// Statements are reads (SELECT, immutable/stable function calls) -- no data is
// written, and only outcomes / error codes are printed.
//   Preview:    node --env-file=.env.preview.local scripts/operations/db-privilege-denial-check.mjs
//   Production: node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/db-privilege-denial-check.mjs
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

if (process.argv.length !== 2) throw new Error("No arguments accepted");
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const db = new Client({ connectionString: process.env.DIRECT_URL, connectionTimeoutMillis: 15000 });

// expect: "denied" = SQLSTATE 42501 (insufficient_privilege); "allowed" = no error.
const attempts = [
  { role: "anon", sql: `SELECT 1 FROM public."LostPost" LIMIT 0`, expect: "denied" },
  { role: "anon", sql: `SELECT 1 FROM public."User" LIMIT 0`, expect: "denied" },
  { role: "authenticated", sql: `SELECT 1 FROM public."Message" LIMIT 0`, expect: "denied" },
  { role: "authenticated", sql: `SELECT 1 FROM public."OperationalMetricDaily" LIMIT 0`, expect: "denied" },
  { role: "anon", sql: `SELECT public.thank_note_tags_unique(ARRAY['a']::text[])`, expect: "denied" }, // was PUBLIC EXECUTE
  { role: "authenticated", sql: `SELECT public.mju_chat_member_allowed(0, 0)`, expect: "denied" },
  { role: "service_role", sql: `SELECT 1 FROM public."LostPost" LIMIT 0`, expect: "denied" }, // never had SELECT: unchanged
  { role: "postgres", sql: `SELECT count(*) FROM public."FoundPost"`, expect: "allowed" },
  { role: "postgres", sql: `SELECT count(*) FROM public."TextEmbeddingJob"`, expect: "allowed" },
  { role: "postgres", sql: `SELECT public.thank_note_tags_unique(ARRAY['a','b']::text[])`, expect: "allowed" }, // CHECK constraint function
  { role: "postgres", sql: `SELECT public.mju_activity_audience(NULL)`, expect: "allowed" }, // trigger / stats helper
];

const results = [];
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const member = (await db.query(`SELECT r, pg_has_role(current_user, r, 'MEMBER') AS m FROM unnest(ARRAY['anon','authenticated','service_role']) r`)).rows;
  const canSwitch = Object.fromEntries(member.map((x) => [x.r, x.m]));
  canSwitch.postgres = true;
  for (const a of attempts) {
    if (!canSwitch[a.role]) { results.push({ ...a, outcome: "skipped (cannot switch role)" }); continue; }
    await db.query("SAVEPOINT attempt");
    let outcome;
    try {
      if (a.role !== "postgres") await db.query(`SET LOCAL ROLE ${a.role}`);
      await db.query(a.sql);
      outcome = "allowed";
    } catch (e) {
      outcome = e.code === "42501" ? "denied" : `error ${e.code}`;
      if (a.optional && e.code === "42883") outcome = "skipped (signature differs)";
    }
    await db.query("ROLLBACK TO SAVEPOINT attempt"); // also undoes SET LOCAL ROLE
    const back = (await db.query("SELECT current_user AS u")).rows[0].u;
    if (back !== "postgres") throw new Error("Role did not return to postgres");
    results.push({ role: a.role, sql: a.sql, expect: a.expect, outcome, ok: outcome === a.expect || outcome.startsWith("skipped") });
  }
  await db.query("ROLLBACK");
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await db.end().catch(() => {});
}
const passed = results.every((r) => r.ok !== false);
console.log(JSON.stringify({ target, passed, results }, null, 1));
if (!passed) process.exitCode = 1;
