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
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.cwd(), "package.json"));
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

const [outDir, flag, expected] = process.argv.slice(2);
if (!outDir || flag !== "--expect" || !expected) throw new Error("usage: backup.mjs <outDir> --expect <project-ref>");
const url = process.env.DIRECT_URL ?? "";
if (!url.includes(expected)) throw new Error(`DIRECT_URL is not project ${expected} -- refusing`);
if (fs.existsSync(outDir) && fs.readdirSync(outDir).length) throw new Error(`${outDir} is not empty`);
const bin = (name) => path.join(process.env.PG_BIN ?? "", process.platform === "win32" ? `${name}.exe` : name);

fs.mkdirSync(path.join(outDir, "db"), { recursive: true });
fs.mkdirSync(path.join(outDir, "storage"), { recursive: true });
const run = (name, args) => execFileSync(bin(name), args, { stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 30 });

console.log("dumping database ...");
run("pg_dump", [url, "-Fc", "-f", path.join(outDir, "db/full.dump")]);
run("pg_dump", [url, "-Fc", "-n", "public", "-f", path.join(outDir, "db/public.dump")]);
run("pg_dump", [url, "-s", "-n", "public", "-f", path.join(outDir, "db/public-schema.sql")]);
for (const f of ["full", "public"]) fs.writeFileSync(path.join(outDir, `db/${f}.toc.txt`), run("pg_restore", ["--list", path.join(outDir, `db/${f}.dump`)]));

const db = new Client({ connectionString: url });
await db.connect();
await db.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
const counts = {};
for (const { tablename } of (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).rows) {
  counts[tablename] = Number((await db.query(`SELECT count(*) FROM public."${tablename}"`)).rows[0].count);
}
const migrations = (await db.query(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY 1`)).rows.map((r) => r.migration_name);
await db.end();
fs.writeFileSync(path.join(outDir, "db/rowcounts.json"), JSON.stringify({ takenAt: new Date().toISOString(), counts, migrations }, null, 1));
console.log(`row counts: ${Object.keys(counts).length} tables, last migration ${migrations.at(-1)}`);

console.log("downloading storage ...");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function walk(bucket, prefix, acc) {
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw error;
    for (const e of data) {
      const p = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) await walk(bucket, p, acc);
      else acc.push({ path: p, size: e.metadata?.size, mimetype: e.metadata?.mimetype });
    }
    if (data.length < 1000) break;
  }
  return acc;
}
const { data: buckets, error } = await sb.storage.listBuckets();
if (error) throw error;
const manifest = { buckets: buckets.map((b) => ({ id: b.id, public: b.public })), objects: {} };
for (const b of buckets) {
  const objects = await walk(b.id, "", []);
  for (const o of objects) {
    const { data, error: e } = await sb.storage.from(b.id).download(o.path);
    if (e) throw new Error(`${b.id}/${o.path}: ${e.message}`);
    const buf = Buffer.from(await data.arrayBuffer());
    const file = path.join(outDir, "storage", b.id, o.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    o.sha256 = createHash("sha256").update(buf).digest("hex");
    o.downloadedBytes = buf.length;
  }
  manifest.objects[b.id] = objects;
  console.log(`  ${b.id}: ${objects.length} objects, size mismatches ${objects.filter((o) => o.size !== o.downloadedBytes).length}`);
}
fs.writeFileSync(path.join(outDir, "storage/objects.json"), JSON.stringify(manifest, null, 1));

const files = [];
const list = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) list(p); else files.push(p); } };
list(outDir);
fs.writeFileSync(path.join(outDir, "SHA256SUMS"), files.sort().map((f) => `${createHash("sha256").update(fs.readFileSync(f)).digest("hex")}  ${path.relative(outDir, f).split(path.sep).join("/")}`).join("\n") + "\n");
console.log(`done: ${files.length} files in ${outDir}. Next: scripts/backup/verify-restore.mjs ${outDir}`);
