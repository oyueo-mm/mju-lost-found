// Verifies a backup folder against its own SHA256SUMS (written by backup.mjs).
//
//   node scripts/backup/checksums.mjs verify <backupDir>
//
// Prints counts only (no file contents, no paths of personal data beyond the
// relative file names of mismatches). Exit 0 only when every listed file is
// present with the same hash and no extra file exists.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [mode, dir] = process.argv.slice(2);
if (mode !== "verify" || !dir) throw new Error("usage: checksums.mjs verify <backupDir>");
const listFile = path.join(dir, "SHA256SUMS");
if (!fs.existsSync(listFile)) throw new Error("no SHA256SUMS in the backup folder");
const expected = new Map();
for (const line of fs.readFileSync(listFile, "utf8").split("\n")) {
  const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line.trim());
  if (m) expected.set(m[2], m[1]);
}
const actual = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else actual.push(path.relative(dir, p).split(path.sep).join("/"));
  }
};
walk(dir);
let mismatched = 0, missing = 0;
for (const [rel, hash] of expected) {
  const file = path.join(dir, rel);
  if (!fs.existsSync(file)) { missing++; console.log(`missing: ${rel}`); continue; }
  if (createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== hash) { mismatched++; console.log(`mismatch: ${rel}`); }
}
const extra = actual.filter((rel) => rel !== "SHA256SUMS" && !expected.has(rel));
for (const rel of extra) console.log(`unexpected: ${rel}`);
const ok = expected.size > 0 && mismatched === 0 && missing === 0 && extra.length === 0;
console.log(`checksums: ${expected.size} listed, ${mismatched} mismatched, ${missing} missing, ${extra.length} unexpected -> ${ok ? "CHECKSUMS OK" : "CHECKSUMS FAILED"}`);
process.exit(ok ? 0 : 1);
