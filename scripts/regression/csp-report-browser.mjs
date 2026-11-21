// D-4 CSP report collection check on a LOCAL build against the Preview database.
// Build with Report-Only first (read at build time), then run:
//   MJU_CSP_MODE=report-only node scripts/regression/build-preview.mjs --confirm-preview
//   node --env-file=.vercel/regression-preview.env --env-file=.env.preview.local scripts/regression/csp-report-browser.mjs --confirm-preview
// Rebuild without MJU_CSP_MODE afterwards for other regressions.
//
// 1. clean phase: normal anonymous pages in Chromium + WebKit -> the server
//    must receive NO report.
// 2. inject phase: a deliberate cross-origin image + fetch per engine ->
//    both engines report through report-uri; the server logs them (route
//    pattern only) and counts them in MetricDaily.
// 3. no query string / marker secret reaches the log; counters exist.
// Test data: MetricDaily rows "csp.*" for today and RateLimitCounter rows
// "cspReport:*" on Preview. They did not exist before this feature; the
// script deletes exactly those it finds after the run (printed).
import "../db/install-guard.mjs";
import { assertDatabaseEnvironment, assertScriptSupabaseAccess } from "../../src/lib/db/accessPolicy.mjs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import pg from "pg";

if (!process.argv.includes("--confirm-preview") || assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview" || assertScriptSupabaseAccess(process.env) !== "preview") throw new Error("Preview confirmation required");
const PORT = 3109;
const BASE = `http://127.0.0.1:${PORT}`;
const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();
const lines = [];
let server;
let owned = false; // cleanup only when this run started from zero rows
const out = { checks: [], passed: false };
const check = (name, ok, detail) => { out.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) throw new Error(`failed: ${name}`); };
const py = (phase, post) => {
  const r = spawnSync("python", ["-I", "scripts/regression/csp-report-browser.py", phase], { env: { ...process.env, CSP_BASE: BASE, CSP_POST: JSON.stringify(post), PYTHONUTF8: "1" }, encoding: "utf8", timeout: 600000 });
  const last = (r.stdout ?? "").trim().split("\n").at(-1);
  try { return JSON.parse(last); } catch { return { passed: false, error: (r.stderr ?? "").slice(-400) }; }
};
const reports = () => lines.filter((l) => l.includes("csp-violation"));
const existingRows = async () => ({
  metrics: (await db.query(`SELECT metric, value FROM "MetricDaily" WHERE metric LIKE 'csp.%' ORDER BY metric`)).rows,
  limits: (await db.query(`SELECT count(*)::int AS n FROM "RateLimitCounter" WHERE key LIKE 'cspReport:%'`)).rows[0].n,
});
try {
  const before = await existingRows();
  check("no csp.* counters or cspReport limiter rows before the run", before.metrics.length === 0 && before.limits === 0, before);
  owned = true;
  await new Promise((resolve, reject) => { const s = createServer(); s.once("error", reject); s.listen(PORT, "127.0.0.1", () => s.close(resolve)); });
  const post = (await db.query(`SELECT 'found' AS type, id FROM "FoundPost" WHERE image_url IS NOT NULL AND removed_at IS NULL AND temp_hidden_at IS NULL ORDER BY id DESC LIMIT 1`)).rows[0];
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], { env: { ...process.env, AUTH_TRUST_HOST: "true" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (d) => lines.push(...String(d).split("\n")));
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${BASE}/api/version`)).status === 200) break; } catch {}
    if (i === 40) throw new Error("Local server did not start");
    await new Promise((r) => setTimeout(r, 1000));
  }
  const clean = py("clean", post);
  check("clean phase browser flows", clean.passed, clean.error ?? clean.checks);
  await new Promise((r) => setTimeout(r, 3000));
  check("normal pages send no CSP report", reports().length === 0, reports().slice(0, 5));

  const inject = py("inject", post);
  check("inject phase browser run", inject.passed, inject.error ?? inject.checks);
  await new Promise((r) => setTimeout(r, 3000));
  const got = reports();
  const has = (engine, dir) => got.some((l) => l.includes(`csp-check-${engine}.invalid`) && l.includes(`"dir":"${dir}"`));
  check("Chromium delivered via report-uri (img-src, connect-src)", has("chromium", "img-src") && has("chromium", "connect-src"), got.filter((l) => l.includes("chromium")).length);
  check("WebKit delivered via report-uri (img-src, connect-src)", has("webkit", "img-src") && has("webkit", "connect-src"), got.filter((l) => l.includes("webkit")).length);
  check("log lines carry no query string or marker secret", got.every((l) => !l.includes("secret") && !l.includes("?")), got.slice(0, 4).map((l) => l.slice(l.indexOf("csp-violation"))));

  // MetricDaily is written by the batched metrics flush (2-20 s after the request).
  let metrics = [];
  for (let i = 0; i < 30; i++) {
    metrics = (await db.query(`SELECT metric, value FROM "MetricDaily" WHERE metric LIKE 'csp.%' ORDER BY metric`)).rows;
    if (metrics.some((m) => m.metric === "csp.report.img-src.external") && metrics.some((m) => m.metric === "csp.report.connect-src.external")) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  check("counters written: csp.report.img-src.external and csp.report.connect-src.external", metrics.some((m) => m.metric === "csp.report.img-src.external") && metrics.some((m) => m.metric === "csp.report.connect-src.external"), metrics);
  check("only bounded counter names (no host, path or query in the name)", metrics.every((m) => /^csp\.(report|enforce|ignored)\.[a-z_-]+(\.[a-z_-]+)?$/.test(m.metric)), metrics.map((m) => m.metric));
  out.passed = true;
} catch (error) {
  out.error = error.message;
} finally {
  server?.kill();
  // cleanup: exactly the rows this feature created (none existed before)
  if (owned) {
    await new Promise((r) => setTimeout(r, 2000)); // let a last batched flush land first
    const m = await db.query(`DELETE FROM "MetricDaily" WHERE metric LIKE 'csp.%' RETURNING metric, value`);
    const l = await db.query(`DELETE FROM "RateLimitCounter" WHERE key LIKE 'cspReport:%' RETURNING key`);
    out.cleanup = { metricDailyRowsDeleted: m.rows, rateLimitRowsDeleted: l.rowCount };
  } else out.cleanup = "skipped: rows existed before the run (not ours)";
  await db.end();
}
console.log(JSON.stringify(out, null, 1));
process.exit(out.passed ? 0 : 1);
