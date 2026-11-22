// Read-only log watch after a Production deploy, or around a moment the
// operator reports (e.g. "I logged in and tested at 16:05"). Counts only: no
// log bodies, user ids or full paths are printed (paths reduced to a route
// class). Error messages are cut to 90 characters for grouping.
//
//   node scripts/operations/post-deploy-watch.mjs <dpl_…> --watch [rounds=8] [minutes=5]
//       every N minutes, the last N+1 minutes (stale-client incident: the
//       first logged-in failure came 17 minutes after the deploy)
//   node scripts/operations/post-deploy-watch.mjs <dpl_…> --around <ISO time> [minutes=10]
//       one window: <time> - minutes .. <time> + minutes
//
// "loggedIn2xx" counts 2xx responses on API routes that answer 401 without a
// session -- direct evidence that logged-in requests succeeded. Notes: the
// Vercel CLI returns at most --limit rows per query (500 here), and on the
// Hobby plan runtime logs are kept for about ONE HOUR -- check a reported
// moment within the hour.
import { spawnSync } from "node:child_process";

const [id, mode, a, b] = process.argv.slice(2);
if (!/^dpl_[A-Za-z0-9]+$/.test(id ?? "") || !["--watch", "--around"].includes(mode)) {
  console.error("usage: post-deploy-watch.mjs <dpl_…> --watch [rounds] [minutes] | --around <ISO time> [minutes]");
  process.exit(2);
}
// API routes that require a session (anonymous: 401) and pages only members open.
const LOGGED_IN = /^\/(api\/(me|notifications|chat|admin|reports|upload)(\/|$|\?)|chat(\/|$)|my(\/|$)|admin(\/|$))/;
const LOGGED_IN_API = /^\/api\/(me|notifications|chat|admin|reports|upload)(\/|$|\?)/;
const routeClass = (p = "") => (LOGGED_IN.test(p) ? `member:${p.split(/[/?]/)[1] === "api" ? "/api/" + p.split(/[/?]/)[2] : "/" + p.split(/[/?]/)[1]}` : p.startsWith("/api/") ? "api:other" : "page");

function query(since, until, extra = "") {
  // The end is applied locally: the CLI answers HTTP 400 to some --until
  // windows (e.g. one starting beyond log retention).
  const r = spawnSync(`npx --no-install vercel logs ${id} --since ${since} ${extra} --json --limit 500`, { shell: true, encoding: "utf8", maxBuffer: 64 << 20, windowsHide: true });
  if (r.status) throw new Error("log query failed (runtime logs are kept about one hour on the Hobby plan)");
  const end = Date.parse(until);
  return r.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((row) => row && row.timestamp <= end);
}

function summarize(since, until) {
  const rows = query(since, until);
  const errors = query(since, until, "--level error");
  const byClass = {};
  for (const r of rows) {
    const k = `${routeClass(r.requestPath)} ${String(r.responseStatusCode ?? "-").replace(/\d\d$/, "xx")}`;
    byClass[k] = (byClass[k] ?? 0) + 1;
  }
  const errorKinds = {};
  for (const e of errors) { const m = String(e.message ?? "").replace(/\s+/g, " ").slice(0, 90); errorKinds[m] = (errorKinds[m] ?? 0) + 1; }
  return {
    window: [since, until], requests: rows.length, possiblyTruncated: rows.length >= 50, // the CLI has returned at most ~50 rows per query here
    // API routes only: a member-only PAGE can answer 200 to an anonymous RSC
    // prefetch (the redirect is inside the payload), so pages prove nothing.
    loggedIn2xx: rows.filter((r) => LOGGED_IN_API.test(r.requestPath ?? "") && r.responseStatusCode >= 200 && r.responseStatusCode < 300).length,
    status5xx: rows.filter((r) => r.responseStatusCode >= 500).length,
    errors: errors.length, errorKinds, byClass,
  };
}

let failed = false;
if (mode === "--around") {
  const at = new Date(a), minutes = Number(b ?? 10);
  if (Number.isNaN(at.getTime())) throw new Error("--around needs an ISO time, e.g. 2026-11-22T16:05:00+09:00");
  const s = summarize(new Date(at - minutes * 60000).toISOString(), new Date(+at + minutes * 60000).toISOString());
  console.log(JSON.stringify(s, null, 1));
  failed = s.errors > 0 || s.status5xx > 0;
} else {
  const rounds = Number(a ?? 8), minutes = Number(b ?? 5);
  for (let i = 0; i < rounds; i++) {
    if (i) await new Promise((r) => setTimeout(r, minutes * 60000));
    const now = Date.now();
    const s = summarize(new Date(now - (minutes + 1) * 60000).toISOString(), new Date(now).toISOString());
    console.log(JSON.stringify({ round: i + 1, ...s }));
    failed ||= s.errors > 0 || s.status5xx > 0;
  }
}
process.exitCode = failed ? 1 : 0;
