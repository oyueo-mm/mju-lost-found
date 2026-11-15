import "../db/install-guard.mjs";
// Full backup of one environment (DB + Storage), read-only on the source.
//
//   PG_BIN=<dir with pg_dump> node --env-file=.env scripts/backup/backup.mjs <outDir> --expect <project-ref>
//
// - Refuses to run unless DIRECT_URL belongs to the expected Supabase project
//   (--expect, e.g. the Production ref), so a backup is never taken from the
//   wrong place by accident.
// - Writes: db/full.dump (whole DB), db/public.dump (app schema), db/public-schema.sql,
//   db/*.toc.txt, db/rowcounts.json (exact counts, read-only session),
//   storage/<bucket>/** + storage/objects.json (path, size, sha256), SHA256SUMS.
// - The output holds personal data: keep it outside the repository, on an
//   encrypted disk, and delete old copies per docs/operations.md §5.
// Verify a backup with scripts/backup/verify-restore.mjs.
import { execFile } from "node:child_process";
import { withBackupSnapshot } from "./snapshot.mjs";
import { assertSnapshotObjects, assertSnapshotBytes } from "./storage-snapshot.mjs";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { assertDatabaseAccess } from "../../src/lib/db/accessPolicy.mjs";

const require = createRequire(path.join(process.cwd(), "package.json"));
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

const [outDir, flag, expected] = process.argv.slice(2);
if (!outDir || flag !== "--expect" || !expected) throw new Error("usage: backup.mjs <outDir> --expect <project-ref>");
const url = process.env.DIRECT_URL ?? "";
assertDatabaseAccess(url, process.env, { usage: "operation" });
if (!url.includes(expected)) throw new Error(`DIRECT_URL is not project ${expected} -- refusing`);
if (fs.existsSync(outDir) && fs.readdirSync(outDir).length) throw new Error(`${outDir} is not empty`);
const bin = (name) => path.join(process.env.PG_BIN ?? "", process.platform === "win32" ? `${name}.exe` : name);

fs.mkdirSync(path.join(outDir, "db"), { recursive: true });
fs.mkdirSync(path.join(outDir, "storage"), { recursive: true });
const run = (name, args, signal) => new Promise((resolve, reject) => {
  execFile(bin(name), args, { maxBuffer: 1 << 30, signal, timeout: 240000, windowsHide: true }, (error, stdout) => {
    if (error) reject(new Error(`${name} failed (${error.code ?? error.name}); sensitive diagnostics suppressed`));
    else resolve(stdout);
  });
});

const db = new Client({ connectionString: url });
await db.connect();
const counts = {};
let migrations, bucketRows, objectRows;
try {
  await withBackupSnapshot(db, async (snapshot, signal) => {
    console.log("dumping database with a shared read-only snapshot ...");
    for (const { tablename } of (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).rows) {
      const quoted = tablename.replaceAll('"', '""');
      counts[tablename] = Number((await db.query(`SELECT count(*) FROM public."${quoted}"`)).rows[0].count);
    }
    migrations = (await db.query(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY 1`)).rows.map(r => r.migration_name);
    bucketRows = (await db.query("SELECT id, public FROM storage.buckets ORDER BY id")).rows;
    objectRows = (await db.query("SELECT id, bucket_id, name, metadata, updated_at, version FROM storage.objects ORDER BY bucket_id, name")).rows;
    await run("pg_dump", [url, "--snapshot", snapshot, "-Fc", "-f", path.join(outDir, "db/full.dump")], signal);
    await run("pg_dump", [url, "--snapshot", snapshot, "-Fc", "-n", "public", "-f", path.join(outDir, "db/public.dump")], signal);
    await run("pg_dump", [url, "--snapshot", snapshot, "-s", "-n", "public", "-f", path.join(outDir, "db/public-schema.sql")], signal);
  });
} finally {
  await db.end();
}
for (const f of ["full", "public"]) fs.writeFileSync(path.join(outDir, `db/${f}.toc.txt`), await run("pg_restore", ["--list", path.join(outDir, `db/${f}.dump`)]));
fs.writeFileSync(path.join(outDir, "db/rowcounts.json"), JSON.stringify({ takenAt: new Date().toISOString(), counts, migrations }, null, 1));
console.log(`row counts: ${Object.keys(counts).length} tables, last migration ${migrations.at(-1)}`);

console.log("downloading storage ...");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// Inventory is from the SAME DB snapshot, not paginated live Storage lists.
// New uploads after the snapshot are intentionally outside this backup.
const buckets = bucketRows;
const manifest = { buckets: buckets.map((b) => ({ id: b.id, public: b.public })), objects: {} };
for (const b of buckets) {
  const objects = objectRows.filter(o => o.bucket_id === b.id).map(o => ({ path: o.name, size: o.metadata?.size, etag: o.metadata?.eTag, mimetype: o.metadata?.mimetype, version: o.version, updatedAt: o.updated_at, id: o.id }));
  for (const o of objects) {
    const { data, error: e } = await sb.storage.from(b.id).download(o.path);
    if (e) throw new Error("Snapshot Storage object unavailable; backup incomplete");
    const buf = Buffer.from(await data.arrayBuffer());
    const file = path.join(outDir, "storage", b.id, o.path);
    const root = path.resolve(outDir, "storage");
    if (!path.resolve(file).startsWith(root + path.sep)) throw new Error("Unsafe Storage path");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    o.sha256 = createHash("sha256").update(buf).digest("hex");
    o.downloadedBytes = buf.length;
    assertSnapshotBytes(o, buf);
  }
  manifest.objects[b.id] = objects;
  console.log(`  ${b.id}: ${objects.length} objects, size mismatches ${objects.filter((o) => o.size !== o.downloadedBytes).length}`);
}
// A deleted/replaced object must fail closed, never silently disappear from
// the manifest. Storage and Postgres are not an atomic cross-system snapshot.
const current = new Client({ connectionString: url });
try {
  await current.connect(); await current.query("BEGIN READ ONLY");
  const rows = (await current.query("SELECT id, bucket_id, name, updated_at, version FROM storage.objects")).rows;
  assertSnapshotObjects(objectRows, rows);
  await current.query("COMMIT");
} finally { await current.end(); }
fs.writeFileSync(path.join(outDir, "storage/objects.json"), JSON.stringify(manifest, null, 1));

const files = [];
const list = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) list(p); else files.push(p); } };
list(outDir);
fs.writeFileSync(path.join(outDir, "SHA256SUMS"), files.sort().map((f) => `${createHash("sha256").update(fs.readFileSync(f)).digest("hex")}  ${path.relative(outDir, f).split(path.sep).join("/")}`).join("\n") + "\n");
console.log(`done: ${files.length} files in ${outDir}. Next: scripts/backup/verify-restore.mjs ${outDir}`);
