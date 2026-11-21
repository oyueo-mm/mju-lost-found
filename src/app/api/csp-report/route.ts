// POST /api/csp-report -- CSP violation reports from browsers (D-4).
//
// Anonymous on purpose: browsers send these without cookies (Reporting API)
// or with no reliable session, from signed-out pages too. So the endpoint
// trusts nothing in the body and keeps almost nothing of it
// (lib/security/cspReport.ts): bounded counters in MetricDaily (batched with
// the other metrics, kept CSP_REPORT_RETENTION_DAYS -- lib/retention) and one
// short log line per violation. No raw report, URL query, IP, user agent or
// user id is stored.
//
// Cost guards, cheapest first, so junk never reaches the database:
//   1. Content-Type must be a report type            -> 415
//   2. body at most 16 KiB (declared and streamed)   -> 413
//   3. parsed + filtered in memory (foreign page / extension / malformed -> 204, counted only)
//   4. per-IP rate limit (salted hash, shared RateLimitCounter) -> 429
// Every other answer is 204 with no body, so a sender learns nothing.
import { NextResponse } from "next/server";

import { addDailyCount } from "@/lib/metrics/record";
import { checkRateLimit, clientIpFrom } from "@/lib/rateLimit";
import {
  CSP_REPORT_MAX_BYTES,
  contentTypeAccepted,
  cspIgnoredMetric,
  cspMetricName,
  parseCspReports,
} from "@/lib/security/cspReport";

export const dynamic = "force-dynamic";

const empty = (status: number, extra: Record<string, string> = {}) =>
  new NextResponse(null, { status, headers: { "Cache-Control": "no-store", ...extra } });

async function readCapped(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > CSP_REPORT_MAX_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CSP_REPORT_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function POST(request: Request) {
  if (!contentTypeAccepted(request.headers.get("content-type"))) return empty(415);
  const text = await readCapped(request);
  if (text === null) {
    addDailyCount(cspIgnoredMetric("too_large"));
    return empty(413);
  }
  // The origin the browser actually used (Host header): behind `next start`
  // request.url may name a different local host spelling than the page had.
  const url = new URL(request.url);
  const host = request.headers.get("host");
  const origin = host && /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host) ? `${url.protocol}//${host.toLowerCase()}` : url.origin;
  const { violations, ignored } = parseCspReports(text, origin);
  for (const [reason, n] of Object.entries(ignored) as [keyof typeof ignored, number][]) if (n) addDailyCount(cspIgnoredMetric(reason), n);
  if (violations.length === 0) return empty(204);

  const limit = await checkRateLimit("cspReport", { ip: clientIpFrom(request.headers) });
  if (!limit.ok) {
    if (limit.reason === "limited") {
      addDailyCount(cspIgnoredMetric("limited"), violations.length);
      return empty(429, { "Retry-After": String(limit.retryAfterSeconds) });
    }
    return empty(204); // limiter unavailable: drop quietly, never fail the page
  }
  for (const v of violations) {
    addDailyCount(cspMetricName(v));
    // Vercel keeps runtime logs briefly; no query, no user, no IP.
    console.info("csp-violation", JSON.stringify({ d: v.disposition, dir: v.directive, cls: v.blocked, route: v.route, host: v.externalHost, src: v.sourceFile, line: v.line }));
  }
  return empty(204);
}
