// Backup retention (grandfather-father-son) for the scheduled backups.
//
//   node scripts/backup/retention.mjs plan <backupRoot> [--today YYYY-MM-DD]
//     -> JSON { managed, keep, prune } (file names only; deletes nothing)
//
// Policy, over the archives this job manages -- auto-YYYY-MM-DD.tar.enc that
// have a restore-verified marker (auto-YYYY-MM-DD.tar.enc.verified.json):
//   - the newest 7 (daily),
//   - the newest archive of each of the newest 4 ISO weeks (weekly),
//   - the newest archive of each of the newest 3 months (monthly).
// Everything else that is managed may be pruned. Never managed, never pruned:
// archives without the verified marker (failed or unchecked), older
// weekly-*.tar.enc, pre-release/manual backups, anything else in the folder.
// The caller prunes only after the current run itself was restore-verified.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const POLICY = { daily: 7, weekly: 4, monthly: 3 };
const NAME = /^auto-(\d{4}-\d{2}-\d{2})\.tar\.enc$/;

// ISO week key, e.g. "2026-W46" (weeks start on Monday).
export function isoWeek(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** @param {string[]} days verified backup days (YYYY-MM-DD) */
export function selectKeep(days, policy = POLICY) {
  const sorted = [...new Set(days)].sort().reverse();
  const keep = new Set(sorted.slice(0, policy.daily));
  const newestPer = (keyOf, n) => {
    const seen = new Map();
    for (const day of sorted) if (!seen.has(keyOf(day))) seen.set(keyOf(day), day);
    return [...seen.values()].slice(0, n);
  };
  for (const day of newestPer(isoWeek, policy.weekly)) keep.add(day);
  for (const day of newestPer((d) => d.slice(0, 7), policy.monthly)) keep.add(day);
  return keep;
}

/** @param {string[]} files names in the backup root */
export function planRetention(files, { today } = {}) {
  const names = new Set(files);
  const managed = files
    .map((f) => NAME.exec(f))
    .filter((m) => m && names.has(`${m[0]}.verified.json`) && (!today || m[1] <= today))
    .map((m) => m[1]);
  const keep = selectKeep(managed);
  const prune = managed.filter((d) => !keep.has(d)).sort();
  return {
    managed: managed.sort().map((d) => `auto-${d}.tar.enc`),
    keep: [...keep].sort().map((d) => `auto-${d}.tar.enc`),
    prune: prune.map((d) => `auto-${d}.tar.enc`),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, root, ...rest] = process.argv.slice(2);
  if (mode !== "plan" || !root) throw new Error("usage: retention.mjs plan <backupRoot> [--today YYYY-MM-DD]");
  const t = rest.indexOf("--today");
  const today = t >= 0 ? rest[t + 1] : new Date().toLocaleDateString("sv-SE");
  console.log(JSON.stringify(planRetention(fs.readdirSync(root), { today })));
}
