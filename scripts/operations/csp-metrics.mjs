// D-4: read-only CSP violation counters (MetricDaily csp.<disposition>.<directive>.<class>).
// Minimum fields only: day, counter name, value. These rows never hold report
// bodies, URLs, IPs, user agents or user ids (src/lib/security/cspReport.ts),
// and this script reads nothing else -- no RateLimitCounter, no logs.
//
//   Preview:    node --env-file=.env.preview.local scripts/operations/csp-metrics.mjs [--since YYYY-MM-DD]
//   Production: node scripts/db/approved-operation.mjs --confirm-production --approval-reference <ref> -- scripts/operations/csp-metrics.mjs [--since YYYY-MM-DD]
//
// Known test noise is listed separately (KNOWN_TEST_REPORTS), never deleted:
// rows on Production are the service's own data.
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";

// Reports a verification run made on purpose (not real visitors), from the
// runtime log lines (route "/" = Chromium, which trims a cross-origin
// frame's document-uri to the origin; "/login" = WebKit):
//   2026-11-21 19:48:11 Chromium, 19:48:37 WebKit -- hosted-anonymous-browser.py
//     framing check right after the Report-Only deploy;
//   2026-11-21 20:43:22 Chromium -- the same check after it only blocked
//     /api/csp-report (Chromium sends reports outside the page network stack).
// Since then the check strips the Report-Only header from the framed /login
// (X-Frame-Options still blocks and is asserted), so it creates no report.
export const KNOWN_TEST_REPORTS = [{ day: "2026-11-21", metric: "csp.report.frame-ancestors.self", value: 3, source: "hosted-anonymous-browser.py framing check (Chromium x2, WebKit x1)" }];

const args = process.argv.slice(2);
const sinceIndex = args.indexOf("--since");
const since = sinceIndex >= 0 ? args[sinceIndex + 1] : "2026-11-21";
if (!/^\d{4}-\d{2}-\d{2}$/.test(since ?? "") || args.length !== (sinceIndex >= 0 ? 2 : 0)) throw new Error("usage: csp-metrics.mjs [--since YYYY-MM-DD]");

const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const db = new Client(pgConfig(process.env.DIRECT_URL ?? process.env.DATABASE_URL, { connectionTimeoutMillis: 15000 }));
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const rows = (await db.query(`SELECT to_char(day,'YYYY-MM-DD') AS day, metric, value FROM "MetricDaily" WHERE metric LIKE 'csp.%' AND day >= $1::date ORDER BY day, metric`, [since])).rows;
  await db.query("ROLLBACK");
  const remaining = new Map(KNOWN_TEST_REPORTS.map((t) => [`${t.day}|${t.metric}`, t.value]));
  const operational = [];
  const test = [];
  for (const r of rows) {
    const key = `${r.day}|${r.metric}`;
    const testValue = Math.min(remaining.get(key) ?? 0, r.value);
    if (testValue > 0) test.push({ ...r, value: testValue });
    if (r.value - testValue > 0) operational.push({ ...r, value: r.value - testValue });
  }
  const sum = (list, prefix) => list.filter((r) => r.metric.startsWith(prefix)).reduce((n, r) => n + r.value, 0);
  console.log(JSON.stringify({
    target,
    readOnly: true,
    since,
    operational,
    knownTest: test,
    totals: {
      operationalReports: sum(operational, "csp.report."),
      operationalEnforced: sum(operational, "csp.enforce."),
      ignored: sum(operational, "csp.ignored."),
      knownTest: test.reduce((n, r) => n + r.value, 0),
    },
  }, null, 1));
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  console.error("CSP metrics read failed:", error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await db.end();
}
