import "../db/install-guard.mjs";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { assertDatabaseEnvironment, assertScriptSupabaseAccess } from "../../src/lib/db/accessPolicy.mjs";
import { checkReleaseCMigrations } from "./release-c-production-policy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";

// Deliberate entry point for the existing approved-operation launcher. No
// credentials are loaded here; no guard, grants, policies or defaults change.
const [action, ...flags] = process.argv.slice(2);
if (!["preflight", "bucket", "migrate"].includes(action) || flags.some((f) => !["--apply", "--confirm-production"].includes(f))) throw new Error("Usage: release-c-production.mjs preflight|bucket|migrate [--apply --confirm-production]");
if (assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "production") throw new Error("Production only, through the approved launcher");
assertScriptSupabaseAccess(process.env);
const apply = flags.includes("--apply");
if (apply && !flags.includes("--confirm-production")) throw new Error("Missing production confirmation flag");
const migration = "20261121000000_report_snapshot";
const checksum = createHash("sha256").update(readFileSync(resolve("prisma/migrations", migration, "migration.sql"))).digest("hex");
const local = readdirSync("prisma/migrations", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const wanted = { public: false, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"] };
function verifyBucket(bucket) {
  if (bucket.public !== false || bucket.file_size_limit !== wanted.fileSizeLimit || JSON.stringify([...(bucket.allowed_mime_types ?? [])].sort()) !== JSON.stringify([...wanted.allowedMimeTypes].sort())) throw new Error("Existing evidence bucket settings differ; refusing to change them");
}
const db = new Client(pgConfig(process.env.DIRECT_URL));
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const rows = (await db.query(`SELECT migration_name, checksum, finished_at IS NOT NULL AS applied, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY started_at`)).rows;
  const pending = checkReleaseCMigrations(local, rows, checksum);
  const columns = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='Report' AND column_name IN ('target_snapshot','snapshot_at','snapshot_purged_at')`)).rows;
  if (columns.length !== (pending.length ? 0 : 3)) throw new Error("Unexpected snapshot column state");
  const readPolicies = (await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND cmd IN ('ALL','SELECT') AND roles && ARRAY['public','anon','authenticated']::name[]`)).rows[0].n;
  if (readPolicies !== 0) throw new Error("Unexpected client Storage read policy; review before creating evidence bucket");
  const locks = (await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE relation='"Report"'::regclass AND pid<>pg_backend_pid() AND granted AND mode NOT IN ('AccessShareLock','RowShareLock')`)).rows[0].n;
  if (locks !== 0) throw new Error("Report has another writer; retry preflight before migration");
  await db.query("ROLLBACK");
  const buckets = await sb.storage.listBuckets();
  if (buckets.error) throw new Error("Bucket metadata read failed");
  const bucket = buckets.data.find((b) => b.id === "report-evidence");
  if (bucket) verifyBucket(bucket);
  console.log(JSON.stringify({ action, apply, pending, snapshotColumns: columns.length, evidenceBucketExists: !!bucket, clientStorageReadPolicies: readPolicies }));
  if (!apply || action === "preflight") process.exitCode = 0;
  else if (action === "bucket") {
    if (!bucket) {
      const result = await sb.storage.createBucket("report-evidence", wanted);
      if (result.error) throw new Error("Evidence bucket creation failed");
    }
    const result = await sb.storage.getBucket("report-evidence");
    if (result.error || !result.data) throw new Error("Created bucket verification failed");
    verifyBucket(result.data);
    console.log(JSON.stringify({ evidenceBucket: "report-evidence", private: true, verified: true }));
  } else if (action === "migrate") {
    if (!bucket) throw new Error("Create and verify private evidence bucket before migration");
    if (pending.length) {
      // Prisma retains its own migration history/locking. Only release C may
      // be pending. Capture CLI output: never print a datasource or credentials.
      const result = spawnSync(process.execPath, ["--import", new URL("../db/install-guard.mjs", import.meta.url).href,
        resolve("node_modules/prisma/build/index.js"), "migrate", "deploy", "--config", resolve("prisma7.config.ts")],
      { env: { ...process.env, PGOPTIONS: "-c lock_timeout=5000 -c statement_timeout=60000" }, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
      if (result.status !== 0 || result.error) throw new Error("Prisma migration failed; output suppressed, inspect migration metadata before any retry");
    }
    await db.query("BEGIN READ ONLY");
    const after = (await db.query(`SELECT migration_name, checksum, finished_at IS NOT NULL AS applied, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY started_at`)).rows;
    if (checkReleaseCMigrations(local, after, checksum).length) throw new Error("Release C did not finish");
    const constraint = (await db.query(`SELECT convalidated FROM pg_constraint WHERE conrelid='"Report"'::regclass AND conname='Report_snapshot_check'`)).rows;
    if (constraint.length !== 1 || !constraint[0].convalidated) throw new Error("Snapshot constraint missing or not validated");
    await db.query("ROLLBACK");
    console.log(JSON.stringify({ migration, applied: true, constraintValidated: true }));
  }
} catch (e) {
  await db.query("ROLLBACK").catch(() => {});
  console.error("Release C operation stopped", e.code ?? (e.message?.includes("credentials") ? "Migration failed; inspect metadata" : e.message));
  process.exitCode = 1;
} finally { await db.end(); }
