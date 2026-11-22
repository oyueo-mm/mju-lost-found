// Read-only: ACL, RLS and policies of ONE public table, plus what each role can
// do with it (has_table_privilege). Metadata only, BEGIN READ ONLY, verified TLS.
//   node --env-file=.env.preview.local scripts/operations/table-acl-check.mjs UploadIntent
//   node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/table-acl-check.mjs UploadIntent
import "../db/install-guard.mjs";
import { Client } from "pg";
import { pgConfig } from "../db/pgConfig.mjs";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

const table = process.argv[2];
if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(table ?? "")) throw new Error("usage: table-acl-check.mjs <table>");
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const db = new Client(pgConfig(process.env.DIRECT_URL, { connectionTimeoutMillis: 15000 }));
await db.connect();
try {
  await db.query("BEGIN READ ONLY");
  const t = (await db.query(`SELECT c.oid, c.relrowsecurity AS rls, c.relforcerowsecurity AS "forceRls", c.relacl::text AS acl, pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = $1`, [table])).rows[0];
  if (!t) { console.log(JSON.stringify({ target, table, exists: false })); process.exit(0); }
  const policies = Number((await db.query("SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = $1", [table])).rows[0].count);
  const roles = (await db.query(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','backup_reader','mju_chat_realtime','authenticator') ORDER BY 1`)).rows.map((r) => r.rolname);
  const can = {};
  for (const r of roles) {
    const p = (await db.query(`SELECT has_table_privilege($1, $2::oid, 'SELECT') s, has_table_privilege($1, $2::oid, 'INSERT') i, has_table_privilege($1, $2::oid, 'UPDATE') u, has_table_privilege($1, $2::oid, 'DELETE') d, has_table_privilege($1, $2::oid, 'TRUNCATE') tr`, [r, t.oid])).rows[0];
    can[r] = Object.entries(p).filter(([, v]) => v).map(([k]) => k).join("") || "-";
  }
  await db.query("ROLLBACK");
  console.log(JSON.stringify({ target, table, exists: true, owner: t.owner, rls: t.rls, forceRls: t.forceRls, policies, acl: t.acl, can }, null, 1));
} finally {
  await db.end();
}
