// Function Storage C-2: apply 20261124000000_text_embedding_jobs, and nothing
// else. Refuses unless it is the ONLY pending migration and no unresolved
// (failed) row exists. Production must go through approved-operation.mjs:
//   node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/release-c2.mjs migrate --apply --confirm-production
// Without --apply it only reports (read-only).
import "../db/install-guard.mjs";
import { Client } from "pg";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

const NEW = "20261124000000_text_embedding_jobs";
const [action, ...flags] = process.argv.slice(2);
if (action !== "migrate") throw new Error("Usage: release-c2.mjs migrate [--apply --confirm-<target>]");
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
if (!["preview", "production"].includes(target)) throw new Error("Hosted target required");
const apply = flags.includes("--apply");
if (flags.some((f) => f !== "--apply" && f !== `--confirm-${target}`)) throw new Error("Unexpected option");
if (apply && !flags.includes(`--confirm-${target}`)) throw new Error("Target confirmation required");
const local = readdirSync("prisma/migrations", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const db = new Client({ connectionString: process.env.DIRECT_URL, connectionTimeoutMillis: 15000 });
async function pendingState() {
  await db.query("BEGIN READ ONLY");
  const rows = (await db.query(`SELECT migration_name,finished_at IS NOT NULL AS applied,rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations`)).rows;
  await db.query("ROLLBACK");
  const applied = new Set(rows.filter((r) => r.applied && !r.rolled_back).map((r) => r.migration_name));
  return { pending: local.filter((n) => !applied.has(n)), unresolved: rows.filter((r) => !r.applied && !r.rolled_back).map((r) => r.migration_name) };
}
try {
  await db.connect();
  const before = await pendingState();
  console.log(JSON.stringify({ target, apply, before }));
  if (before.unresolved.length) throw new Error("Unresolved migration row; stop");
  if (apply) {
    if (before.pending.length !== 1 || before.pending[0] !== NEW) throw new Error("Refusing: the C-2 migration must be the only pending one");
    const r = spawnSync(process.execPath, ["--import", new URL("../db/install-guard.mjs", import.meta.url).href, resolve("node_modules/prisma/build/index.js"), "migrate", "deploy", "--config", resolve("prisma7.config.ts")], { env: { ...process.env, PGOPTIONS: "-c lock_timeout=5000 -c statement_timeout=60000" }, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    if (r.status !== 0 || r.error) throw new Error("C-2 migration failed; inspect _prisma_migrations before any retry (diagnostics suppressed)");
    const after = await pendingState();
    console.log(JSON.stringify({ target, after }));
    if (after.pending.length || after.unresolved.length) throw new Error("C-2 migration incomplete");
  }
} catch (error) {
  console.error("C-2 operation stopped:", error.message);
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
