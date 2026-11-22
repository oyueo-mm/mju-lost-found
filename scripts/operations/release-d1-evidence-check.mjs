// Aggregate-only, read-only post-deployment checks. No snapshot bodies or IDs.
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const db = new Client(pgConfig(process.env.DIRECT_URL));
try {
  await db.connect(); await db.query("BEGIN READ ONLY");
  await db.query("SET LOCAL statement_timeout='10s'");
  const bucket = (await db.query("SELECT public FROM storage.buckets WHERE id='report-evidence'")).rows;
  const columns = (await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='Report' AND column_name IN ('target_snapshot','snapshot_at','snapshot_purged_at')")).rows[0].n;
  const snapshots = (await db.query('SELECT count(*)::int total, count(target_snapshot)::int snapshots FROM "Report"')).rows[0];
  const objects = (await db.query("SELECT count(*)::int n FROM storage.objects WHERE bucket_id='report-evidence'")).rows[0].n;
  await db.query("ROLLBACK");
  const passed = bucket.length === 1 && bucket[0].public === false && columns === 3;
  console.log(JSON.stringify({ target, privateEvidenceBucket: bucket.length === 1 && !bucket[0].public, snapshotColumns: columns, reports: snapshots, evidenceObjects: objects, passed }));
  if (!passed) process.exitCode = 1;
} catch { console.error("Read-only evidence check failed"); process.exitCode = 1; }
finally { await db.end(); }
