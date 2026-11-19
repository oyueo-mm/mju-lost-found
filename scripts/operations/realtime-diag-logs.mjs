// Timeline of canary-room client diagnostics from a deployment's runtime logs.
// Lines are "Chat realtime diag <event> room <id> participant <8 hex>" (fixed
// vocabulary, no content or identity). Also counts the room's chat API
// requests by method/status so a silent tab can be told from a failing one.
//
//   node scripts/operations/realtime-diag-logs.mjs dpl_xxx 15m 52
import { spawnSync } from "node:child_process";

const [deployment, since, room] = process.argv.slice(2);
if (!/^dpl_[A-Za-z0-9]+$/.test(deployment ?? "") || !/^\d{1,2}m$/.test(since ?? "") || !/^[1-9]\d{0,9}$/.test(room ?? "")) {
  throw new Error("usage: realtime-diag-logs.mjs dpl_ID <N>m <room>");
}
const r = spawnSync(`npx --no-install vercel logs ${deployment} --since ${since} --json --limit 500`, { shell: true, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
if (r.status) throw new Error("Log query failed");
const rows = r.stdout.split(/\r?\n/).filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
const kst = (ms) => new Date(Number(ms) + 9 * 3600e3).toISOString().slice(11, 19);
const diag = [];
const api = {};
for (const row of rows) {
  const text = JSON.stringify(row);
  const m = new RegExp(`Chat realtime diag (\\w[\\w-]*) room ${room} participant ([0-9a-f]{8})`).exec(text);
  if (m) diag.push({ at: kst(row.timestamp), event: m[1], participant: m[2] });
  const path = String(row.requestPath ?? "").split("?")[0];
  if (path.startsWith(`/api/chat/${room}/`)) {
    const key = `${row.requestMethod} ${path.replace(`/api/chat/${room}/`, "")} ${row.responseStatusCode}`;
    api[key] = (api[key] ?? 0) + 1;
  }
}
diag.sort((a, b) => a.at.localeCompare(b.at));
console.log(JSON.stringify({ deployment, window: since, logRows: rows.length, truncatedLikely: rows.length >= 50, diag, roomApi: api }, null, 1));
