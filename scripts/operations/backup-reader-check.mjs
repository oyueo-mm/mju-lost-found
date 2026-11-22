// Access test of the cloud backup role (backup_reader). Flags and counts only.
//   - it reads every public table and gets the SAME row counts as the owner
//     role (so RLS cannot silently hide rows from a backup), plus the Storage
//     inventory and the D-3 Realtime metadata the backup records;
//   - it cannot write, create, or read auth.* -- every write attempt runs in a
//     transaction that is rolled back, so nothing can persist even if a
//     privilege were wrong.
//
//   Preview:    node --env-file=.env.preview.local --env-file=.env.backup-preview.local scripts/operations/backup-reader-check.mjs
//   Production: node --env-file=.env.backup-production.local scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/backup-reader-check.mjs
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment, assertDatabaseAccess } from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";

const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
if (assertDatabaseAccess(process.env.BACKUP_DATABASE_URL, process.env, { usage: "operation" }) !== target) throw new Error("BACKUP_DATABASE_URL is not the same environment");
const reader = new Client(pgConfig(process.env.BACKUP_DATABASE_URL));
const owner = new Client(pgConfig(process.env.DIRECT_URL));
await reader.connect();
await owner.connect();
const attempt = async (sql) => {
  try { await reader.query("BEGIN READ WRITE"); await reader.query(sql); return "ALLOWED"; }
  catch (e) { return e.code ?? "error"; }
  finally { await reader.query("ROLLBACK").catch(() => {}); }
};
try {
  const tables = (await owner.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1`)).rows.map((r) => r.tablename);
  await owner.query("BEGIN READ ONLY");
  await reader.query("BEGIN READ ONLY");
  let readable = 0, sameCount = 0;
  const mismatched = [];
  for (const t of tables) {
    const sql = `SELECT count(*)::bigint AS n FROM public."${t.replaceAll('"', '""')}"`;
    let r;
    try { r = (await reader.query(sql)).rows[0].n; readable++; } catch { mismatched.push(`${t}: unreadable`); continue; }
    const o = (await owner.query(sql)).rows[0].n;
    if (r === o) sameCount++; else mismatched.push(t);
  }
  const storage = { reader: Number((await reader.query("SELECT count(*) FROM storage.objects")).rows[0].count), owner: Number((await owner.query("SELECT count(*) FROM storage.objects")).rows[0].count) };
  const realtimeMetadata = (await reader.query(`SELECT has_table_privilege('mju_chat_realtime','realtime.messages','SELECT') AS ok`).then(() => "readable", (e) => e.code));
  await reader.query("ROLLBACK");
  await owner.query("ROLLBACK");
  const result = {
    target,
    user: (await reader.query("SELECT current_user u")).rows[0].u,
    tls: reader.connection.stream.encrypted === true && reader.connection.stream.authorized === true ? "verified" : "NOT VERIFIED",
    readOnlyDefault: (await reader.query("SHOW default_transaction_read_only")).rows[0].default_transaction_read_only,
    publicTables: tables.length, readable, sameRowCountsAsOwner: sameCount, mismatched,
    rlsTables: Number((await owner.query(`SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity`)).rows[0].count),
    storageObjects: storage, realtimeMetadata,
    writeAttempt: await attempt(`UPDATE "AppSettings" SET id = id WHERE false`),
    createTableAttempt: await attempt("CREATE TABLE public.backup_reader_probe(x int)"),
    readAuthUsers: await attempt("SELECT count(*) FROM auth.users"),
    readVault: await attempt("SELECT count(*) FROM vault.secrets"),
    exportSnapshot: await (async () => { try { await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); await reader.query("SELECT pg_export_snapshot()"); return "allowed"; } catch (e) { return e.code; } finally { await reader.query("ROLLBACK").catch(() => {}); } })(),
  };
  result.passed = result.tls === "verified" && result.readOnlyDefault === "on" && result.readable === tables.length && mismatched.length === 0 && storage.reader === storage.owner
    && realtimeMetadata === "readable" && result.writeAttempt !== "ALLOWED" && result.createTableAttempt !== "ALLOWED" && result.readAuthUsers !== "ALLOWED" && result.readVault !== "ALLOWED" && result.exportSnapshot === "allowed";
  console.log(JSON.stringify(result));
  process.exitCode = result.passed ? 0 : 1;
} finally {
  await reader.end().catch(() => {});
  await owner.end().catch(() => {});
}
