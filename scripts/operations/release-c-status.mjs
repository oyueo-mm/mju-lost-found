import "../db/install-guard.mjs";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { assertDatabaseEnvironment, assertScriptSupabaseAccess } from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";

const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
assertScriptSupabaseAccess(process.env);
const db = new Client(pgConfig(process.env.DIRECT_URL));
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const migrations = (await db.query(`SELECT migration_name, finished_at IS NOT NULL AS applied FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 3`)).rows;
  const columns = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='Report' AND column_name IN ('target_snapshot','snapshot_at','snapshot_purged_at') ORDER BY 1`)).rows;
  const clientStorageReadPolicies = (await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND cmd IN ('ALL','SELECT') AND roles && ARRAY['public','anon','authenticated']::name[]`)).rows[0].n;
  await db.query("ROLLBACK");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.storage.listBuckets();
  if (error) throw new Error("Bucket metadata unavailable");
  const evidence = data.find((b) => b.id === "report-evidence");
  const probe = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY }, signal: AbortSignal.timeout(10000) });
  const body = await probe.json().catch(() => ({}));
  console.log(JSON.stringify({ target, migrations, columns, clientStorageReadPolicies, evidenceBucket: evidence ? { exists: true, public: evidence.public } : { exists: false }, dataApiRootStatus: probe.status, dataApiDisabledMessage: /disabled/i.test(body.message ?? "") }));
} catch (e) { console.error("Status check failed", e.code ?? e.name); process.exitCode = 1; }
finally { await db.end(); }
