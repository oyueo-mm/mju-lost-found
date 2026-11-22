// Preview: proves backup_reader can read (incl. RLS tables, Storage
// inventory) and cannot write or read auth.*. Flags only.
//   node --env-file=.env.backup-preview.local scripts/operations/backup-reader-check.mjs
import { Client } from "pg";
const db = new Client({ connectionString: process.env.BACKUP_DATABASE_URL });
await db.connect();
const attempt = async (sql) => { try { await db.query(sql); return "allowed"; } catch (e) { await db.query("ROLLBACK").catch(() => {}); return e.code ?? "error"; } };
const rls = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity ORDER BY 1`)).rows.map(r => r.tablename);
const rlsReadable = [];
for (const t of rls) rlsReadable.push(await attempt(`SELECT count(*) FROM public."${t}"`));
console.log(JSON.stringify({
  user: (await db.query("SELECT current_user u")).rows[0].u,
  readOnlyDefault: (await db.query("SHOW default_transaction_read_only")).rows[0].default_transaction_read_only,
  rlsTables: rls.length, rlsReadable: rlsReadable.filter(x => x === "allowed").length,
  storageObjects: await attempt("SELECT count(*) FROM storage.objects"),
  writePublic: await attempt(`UPDATE "AppSettings" SET id = id WHERE false`),
  writeEvenIfReadWrite: await attempt(`BEGIN READ WRITE; UPDATE "AppSettings" SET id = id WHERE false; ROLLBACK`),
  createTable: await attempt("CREATE TABLE public.backup_reader_probe(x int)"),
  readAuthUsers: await attempt("SELECT count(*) FROM auth.users"),
  exportSnapshot: await attempt("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot(); ROLLBACK"),
}));
await db.end();
