// D-4 CSP report endpoint check on the HOSTED Preview (Report-Only build:
// node scripts/deployments/deploy.mjs preview --alias --csp-mode=report-only).
//   node --env-file=.env.preview.local scripts/regression/csp-report-hosted.mjs --confirm-preview
//
// Through the project's automation bypass (Deployment Protection stays on):
//   1. header: Content-Security-Policy-Report-Only with report-uri /api/csp-report
//   2. formats: report-uri body, Chromium Reporting API batch, WebKit's
//      combined body -> 204 and counted
//   3. guards: text/plain 415, 17 KiB 413, another origin's page / extension
//      noise / junk -> 204 and NOT counted as violations, GET 405
//   4. per-IP limit: the 31st report request within a minute -> 429
//   5. browsers: Chromium + WebKit pages on the Preview send their own report
//      (deliberate cross-origin image + fetch) -> counted
//   6. Preview DB: only bounded csp.* counter names; runtime log lines carry
//      no query / marker secret
// Test data: MetricDaily "csp.*" and RateLimitCounter "cspReport:*" rows on
// Preview (none exist before the run; checked) -- deleted at the end.
import "../db/install-guard.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import pg from "pg";

if (!process.argv.includes("--confirm-preview") || assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview") throw new Error("Preview confirmation required");
const BASE = "https://mju-lost-found-preview.vercel.app";
const vercelApi = (path) => { const out = execFileSync("npx", ["--no-install", "vercel", "api", path, "--scope", "oyueo"], { encoding: "utf8", shell: true, windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: "1" } }); return JSON.parse(out.slice(out.indexOf("{"))); };
const bypass = Object.keys(vercelApi("/v9/projects/prj_zMYrrsw80l829lSjs2n2Ur6YV5eP").protectionBypass ?? {})[0];
if (!bypass) throw new Error("Project has no automation bypass");
const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();
const out = { base: BASE, checks: [], passed: false };
const check = (name, ok, detail) => { out.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) throw new Error(`failed: ${name}`); };
const send = (body, type = "application/csp-report", method = "POST") =>
  fetch(`${BASE}/api/csp-report`, { method, body: method === "POST" ? body : undefined, headers: { "x-vercel-protection-bypass": bypass, ...(method === "POST" ? { "content-type": type } : {}) }, redirect: "manual" }).then(async (r) => { await r.body?.cancel(); return r.status; });
const marker = `csp-hosted-${Date.now()}`;
const legacy = (host, page = `${BASE}/lost?q=${marker}`) => JSON.stringify({ "csp-report": { "document-uri": page, "effective-directive": "img-src", "violated-directive": "img-src", "blocked-uri": `https://${host}.invalid/p.png?secret=${marker}`, disposition: "report" } });
const counters = async () => (await db.query(`SELECT metric, value FROM "MetricDaily" WHERE metric LIKE 'csp.%' ORDER BY metric`)).rows;
let owned = false;
try {
  const before = { metrics: await counters(), limits: (await db.query(`SELECT count(*)::int AS n FROM "RateLimitCounter" WHERE key LIKE 'cspReport:%'`)).rows[0].n };
  check("no csp.* counters or cspReport limiter rows before the run", before.metrics.length === 0 && before.limits === 0, before);
  owned = true;

  const page = await fetch(`${BASE}/lost`, { headers: { "x-vercel-protection-bypass": bypass } });
  await page.body?.cancel();
  const csp = page.headers.get("content-security-policy-report-only") ?? "";
  check("Report-Only header with report-uri, no enforcing CSP", csp.includes("report-uri /api/csp-report") && !page.headers.get("content-security-policy") && csp.includes("wss://swqvlihgupranzfzjevb.supabase.co"), csp.split(";").map((d) => d.trim().split(" ")[0]));

  check("report-uri body -> 204", (await send(legacy("fmt-legacy"))) === 204);
  check("Chromium Reporting API batch -> 204", (await send(JSON.stringify([{ type: "csp-violation", url: `${BASE}/`, body: { documentURL: `${BASE}/found`, effectiveDirective: "connect-src", blockedURL: "https://fmt-batch.invalid/x", disposition: "report" } }]), "application/reports+json")) === 204);
  check("WebKit combined body -> 204", (await send(JSON.stringify({ type: "csp-violation", url: `${BASE}/`, "csp-report": { "document-uri": `${BASE}/search`, "effective-directive": "font-src", "blocked-uri": "https://fmt-webkit.invalid/f.woff2" } }))) === 204);
  check("text/plain -> 415", (await send(legacy("guard"), "text/plain")) === 415);
  check("17 KiB body -> 413", (await send(JSON.stringify({ "csp-report": { pad: "x".repeat(17 * 1024) } }))) === 413);
  check("GET -> 405", (await send(null, "application/csp-report", "GET")) === 405);
  check("another origin's page -> 204 (dropped)", (await send(legacy("guard-foreign", "https://evil.example/"))) === 204);
  check("extension noise -> 204 (dropped)", (await send(JSON.stringify({ "csp-report": { "document-uri": `${BASE}/`, "effective-directive": "script-src", "blocked-uri": "chrome-extension://abcdefghijklmnop/x.js" } }))) === 204);
  check("junk JSON -> 204 (dropped)", (await send("{\"hello\":1}")) === 204);

  // Browsers (bypass cookie set by the first navigation, so their report POSTs pass protection).
  const post = (await db.query(`SELECT 'found' AS type, id FROM "FoundPost" WHERE image_url IS NOT NULL AND removed_at IS NULL AND temp_hidden_at IS NULL ORDER BY id DESC LIMIT 1`)).rows[0];
  const py = spawnSync("python", ["-I", "scripts/regression/csp-report-browser.py", "inject"], { env: { ...process.env, CSP_BASE: BASE, CSP_POST: JSON.stringify(post), CSP_BYPASS: bypass, PYTHONUTF8: "1" }, encoding: "utf8", timeout: 300000 });
  const browserRun = JSON.parse((py.stdout ?? "").trim().split("\n").at(-1) || "{}");
  check("browser inject run (Chromium + WebKit)", browserRun.passed === true, browserRun.error ?? browserRun.checks);

  // Runtime logs (`vercel logs` returns only the latest ~50 rows, so read them
  // now, before the burst below): csp-violation lines from both engines,
  // without query or marker secret.
  const deployment = vercelApi(`/v13/deployments/mju-lost-found-preview.vercel.app`).id;
  let lines = [];
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const logs = spawnSync(`npx --no-install vercel logs ${deployment} --since 15m --json --limit 200`, { shell: true, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    lines = (logs.stdout ?? "").split("\n").filter((l) => l.includes("csp-violation"));
    if (lines.some((l) => l.includes("csp-check-chromium.invalid")) && lines.some((l) => l.includes("csp-check-webkit.invalid"))) break;
  }
  check("runtime log has csp-violation lines from both engines", lines.some((l) => l.includes("csp-check-chromium.invalid")) && lines.some((l) => l.includes("csp-check-webkit.invalid")), lines.length);
  check("log lines carry no query string or marker secret", lines.every((l) => !l.includes(marker) && !l.includes("secret=")), lines.length);

  // Per-IP minute limit (30; fixed one-minute windows, so the exact count
  // depends on where the window starts): send until 429 (at most 40) --
  // dropped reports never touch the limiter.
  let limitedAt = null;
  for (let i = 1; i <= 40 && limitedAt === null; i++) if ((await send(legacy("burst"))) === 429) limitedAt = i;
  check("per-IP limit answers 429 within the minute", limitedAt !== null, { limitedAfterRequests: limitedAt });

  // Counters are written by the batched metrics flush (2-20 s).
  let rows = [];
  const want = ["csp.report.img-src.external", "csp.report.connect-src.external", "csp.report.font-src.external", "csp.ignored.foreign", "csp.ignored.extension", "csp.ignored.malformed", "csp.ignored.too_large", "csp.ignored.limited"];
  for (let i = 0; i < 25; i++) {
    rows = await counters();
    if (want.every((m) => rows.some((r) => r.metric === m))) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  check("counters present for accepted, dropped, oversized and limited reports", want.every((m) => rows.some((r) => r.metric === m)), rows);
  check("only bounded counter names (no host, path, query or marker)", rows.every((r) => /^csp\.(report|enforce|ignored)\.[a-z_-]+(\.[a-z_-]+)?$/.test(r.metric) && !r.metric.includes(marker)), rows.map((r) => r.metric));
  out.passed = true;
} catch (error) {
  out.error = error.message;
} finally {
  if (owned) {
    await new Promise((r) => setTimeout(r, 25000)); // let pending batched flushes land before cleanup
    const m = await db.query(`DELETE FROM "MetricDaily" WHERE metric LIKE 'csp.%' RETURNING metric, value`);
    const l = await db.query(`DELETE FROM "RateLimitCounter" WHERE key LIKE 'cspReport:%' RETURNING key`);
    out.cleanup = { metricDailyRowsDeleted: m.rows, rateLimitRowsDeleted: l.rowCount };
  } else out.cleanup = "skipped: rows existed before the run (not ours)";
  await db.end();
}
console.log(JSON.stringify(out, null, 1));
process.exit(out.passed ? 0 : 1);
