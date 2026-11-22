// Security hardening release (P-5, A-3, A-4, A-5): its two migrations, and
// nothing else.
//   status            read-only: pending/unresolved migrations, UploadIntent ACL
//   migrate           apply 20261125000000_user_sessions_valid_after then
//                     20261125010000_upload_intents (prisma migrate deploy).
//                     Refuses unless EXACTLY these two are pending, in this
//                     order, and no failed (unresolved) migration row exists.
//   revoke-inherited  UploadIntent: remove every non-owner privilege a default
//                     ACL handed out (Production: service_role TRUNCATE/
//                     REFERENCES/TRIGGER/MAINTAIN) EXCEPT backup_reader SELECT,
//                     which keeps the table in the cloud backup.
// Without --apply nothing is written. Production only through the launcher:
//   node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/release-hardening.mjs status
//   ... release-hardening.mjs migrate --apply --confirm-production
//   ... release-hardening.mjs revoke-inherited --apply --confirm-production
import "../db/install-guard.mjs";
import { Client } from "pg";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";

export const RELEASE_MIGRATIONS = ["20261125000000_user_sessions_valid_after", "20261125010000_upload_intents"];
const KEEP = (g) => g.grantee === "backup_reader" && g.privilege_type === "SELECT";

const [action, ...flags] = process.argv.slice(2);
if (!["status", "migrate", "revoke-inherited"].includes(action)) throw new Error("Usage: release-hardening.mjs status|migrate|revoke-inherited [--apply --confirm-<target>]");
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
if (!["preview", "production"].includes(target)) throw new Error("Hosted target required");
const apply = flags.includes("--apply");
if (flags.some((f) => f !== "--apply" && f !== `--confirm-${target}`)) throw new Error("Unexpected option");
if (apply && !flags.includes(`--confirm-${target}`)) throw new Error("Target confirmation required");
if (action === "status" && apply) throw new Error("status never writes");
const local = readdirSync("prisma/migrations", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const db = new Client(pgConfig(process.env.DIRECT_URL, { connectionTimeoutMillis: 15000 }));

async function migrationState() {
  await db.query("BEGIN READ ONLY");
  const rows = (await db.query(`SELECT migration_name, finished_at IS NOT NULL AS applied, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations`)).rows;
  await db.query("ROLLBACK");
  const applied = new Set(rows.filter((r) => r.applied && !r.rolled_back).map((r) => r.migration_name));
  return { pending: local.filter((n) => !applied.has(n)), unresolved: rows.filter((r) => !r.applied && !r.rolled_back).map((r) => r.migration_name), appliedButNotInCheckout: [...applied].filter((n) => !local.includes(n)) };
}
async function uploadIntentAcl() {
  await db.query("BEGIN READ ONLY");
  const exists = (await db.query(`SELECT to_regclass('public."UploadIntent"') IS NOT NULL AS e`)).rows[0].e;
  const rows = exists ? (await db.query(`SELECT a.grantee::regrole::text AS grantee, a.privilege_type FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public."UploadIntent"'::regclass AND a.grantee <> c.relowner AND a.grantee <> 0 ORDER BY 1, 2`)).rows : [];
  const rls = exists ? (await db.query(`SELECT relrowsecurity AS rls FROM pg_class WHERE oid = 'public."UploadIntent"'::regclass`)).rows[0].rls : null;
  await db.query("ROLLBACK");
  return { exists, rls, nonOwner: rows, extra: rows.filter((g) => !KEEP(g)) };
}

try {
  await db.connect();
  if (action === "status") {
    console.log(JSON.stringify({ target, expected: RELEASE_MIGRATIONS, migrations: await migrationState(), uploadIntent: await uploadIntentAcl() }, null, 1));
  } else if (action === "migrate") {
    const before = await migrationState();
    console.log(JSON.stringify({ target, apply, before }));
    if (before.unresolved.length) throw new Error("Unresolved migration row; stop");
    if (before.appliedButNotInCheckout.length) throw new Error("The database has migrations this checkout does not know; wrong branch?");
    if (apply) {
      if (JSON.stringify(before.pending) !== JSON.stringify(RELEASE_MIGRATIONS)) throw new Error("Refusing: exactly the two hardening migrations must be pending");
      const r = spawnSync(process.execPath, ["--import", new URL("../db/install-guard.mjs", import.meta.url).href, resolve("node_modules/prisma/build/index.js"), "migrate", "deploy", "--config", resolve("prisma7.config.ts")], { env: { ...process.env, PGOPTIONS: "-c lock_timeout=5000 -c statement_timeout=60000" }, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
      if (r.status !== 0 || r.error) throw new Error("migration failed; inspect _prisma_migrations before any retry (diagnostics suppressed)");
      const after = await migrationState();
      console.log(JSON.stringify({ target, after }));
      if (after.pending.length || after.unresolved.length) throw new Error("migration incomplete");
    }
  } else {
    const before = await uploadIntentAcl();
    console.log(JSON.stringify({ target, apply, before }));
    if (!before.exists) throw new Error("UploadIntent does not exist yet");
    if (apply && before.extra.length) {
      const roles = [...new Set(before.extra.map((g) => g.grantee))];
      if (roles.some((r) => !/^[a-z_]+$/.test(r))) throw new Error("Unexpected grantee name");
      await db.query("BEGIN");
      await db.query("SET LOCAL lock_timeout = '5s'");
      for (const role of roles) {
        await db.query(`REVOKE ALL ON TABLE public."UploadIntent" FROM ${role}`);
        if (role === "backup_reader") await db.query(`GRANT SELECT ON TABLE public."UploadIntent" TO backup_reader`);
      }
      await db.query("COMMIT");
      const after = await uploadIntentAcl();
      console.log(JSON.stringify({ target, after }));
      if (after.extra.length || !after.nonOwner.some(KEEP)) throw new Error("UploadIntent privileges not as expected");
    }
  }
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  console.error("hardening release operation stopped:", error.message);
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
