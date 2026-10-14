// Proves a backup from scripts/backup/backup.mjs can be restored: restores
// db/public.dump into an EMPTY, throwaway database and compares every table's
// row count with db/rowcounts.json, then checks that every image path the DB
// references exists in storage/post-images. Optionally rehearses pending
// migrations on the restored copy.
//
//   PG_BIN=<dir with pg_restore/psql> VERIFY_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/verify \
//     node scripts/backup/verify-restore.mjs <backupDir> [--migrations <dir> ...]
//
// The target must be a local scratch database (refuses anything else). It
// needs the pgvector extension available (CREATE EXTENSION vector).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.cwd(), "package.json"));
const { Client } = require("pg");

const [dir, ...rest] = process.argv.slice(2);
const target = process.env.VERIFY_DATABASE_URL ?? "";
if (!dir) throw new Error("usage: verify-restore.mjs <backupDir> [--migrations <migrationDir> ...]");
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(target)) throw new Error("VERIFY_DATABASE_URL must be a local scratch database");
const bin = (name) => path.join(process.env.PG_BIN ?? "", process.platform === "win32" ? `${name}.exe` : name);
const migrations = rest[0] === "--migrations" ? rest.slice(1) : [];

const db = new Client({ connectionString: target });
await db.connect();
const existing = (await db.query(`SELECT count(*)::int n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n;
if (existing > 0) throw new Error("target database is not empty -- use a fresh one");
await db.query(`CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS vector SCHEMA extensions; DROP SCHEMA public`);
execFileSync(bin("pg_restore"), ["-d", target, "--no-owner", "--no-privileges", "--exit-on-error", path.join(dir, "db/public.dump")], { stdio: "inherit" });

const expected = JSON.parse(fs.readFileSync(path.join(dir, "db/rowcounts.json"), "utf8")).counts;
let mismatches = 0;
for (const [table, n] of Object.entries(expected)) {
  const got = Number((await db.query(`SELECT count(*) FROM public."${table}"`)).rows[0].count);
  if (got !== n) { mismatches++; console.log(`MISMATCH ${table}: backup ${n}, restored ${got}`); }
}
console.log(`tables: ${Object.keys(expected).length}, row-count mismatches: ${mismatches}`);

const refs = new Set();
for (const { table_name: t, column_name: c } of (await db.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type IN ('text', 'character varying')`)).rows) {
  for (const { v } of (await db.query(`SELECT "${c}" AS v FROM public."${t}" WHERE "${c}" LIKE '%post-images/%'`)).rows) {
    const m = v.match(/post-images\/([^?"\s]+)/);
    if (m) refs.add(decodeURIComponent(m[1]));
  }
}
const missing = [...refs].filter((p) => !fs.existsSync(path.join(dir, "storage/post-images", p)));
console.log(`image paths referenced: ${refs.size}, missing from backup: ${missing.length}`);

for (const m of migrations) {
  execFileSync(bin("psql"), [target, "-q", "-v", "ON_ERROR_STOP=1", "-f", path.join(m, "migration.sql")], { stdio: "inherit" });
  console.log(`rehearsed migration ${path.basename(m)}`);
}
await db.end();
const ok = mismatches === 0 && missing.length === 0;
console.log(ok ? "RESTORE VERIFIED" : "RESTORE CHECK FAILED");
process.exit(ok ? 0 : 1);
