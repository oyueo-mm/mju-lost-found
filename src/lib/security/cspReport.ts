// D-4: CSP violation reports (POST /api/csp-report) -- parsing and reduction
// to a small, fixed set of counters. Design: docs/operations/release-d4-plan-2026-11-16.md.
//
// The policy names report-uri only (see csp.mjs for why). Every body shape
// a browser may send is still accepted:
//   - report-uri: one report per request, Content-Type application/csp-report,
//     body {"csp-report": {...}} with kebab-case keys (all engines);
//   - Reporting API (report-to): Content-Type application/reports+json, an
//     array of {type: "csp-violation", body: {...}} with camelCase keys
//     (Chromium, batched), or ONE such object sent as application/csp-report
//     (WebKit, observed 2026-11-21 when report-to was named).
//
// Privacy: a report carries full page and resource URLs (query strings,
// tokens), possibly an extension id, a script sample and the user agent.
// None of it is stored. What survives is only:
//   - a counter name  csp.<disposition>.<directive>.<class>  (bounded set);
//   - a log line with the route pattern (ids -> [id], no query), the
//     directive, the class, and for "external" resources only their host.
// Reports for another origin's page (forged, or a copied header elsewhere)
// and reports caused by browser extensions are dropped (counted as ignored).

export { CSP_REPORT_PATH } from "./csp.mjs";
export const CSP_REPORT_MAX_BYTES = 16 * 1024;
export const CSP_REPORT_MAX_PER_REQUEST = 20;
export const CSP_REPORT_CONTENT_TYPES = ["application/csp-report", "application/reports+json", "application/json"] as const;

const DIRECTIVES = new Set([
  "default-src", "script-src", "script-src-elem", "script-src-attr", "style-src", "style-src-elem", "style-src-attr",
  "img-src", "font-src", "connect-src", "media-src", "object-src", "frame-src", "child-src", "worker-src",
  "manifest-src", "frame-ancestors", "form-action", "base-uri", "require-trusted-types-for", "trusted-types",
]);

export type CspBlockedClass =
  | "inline" | "eval" | "wasm-eval" | "data" | "blob" | "self"
  | "supabase" | "google" | "vercel-toolbar" | "external" | "unknown";

export type CspViolation = {
  disposition: "report" | "enforce";
  directive: string; // one of DIRECTIVES or "other"
  blocked: CspBlockedClass;
  route: string; // pathname pattern, no query
  externalHost: string | null; // only for blocked === "external"
  sourceFile: string | null; // same-origin script path only, no query
  line: number | null;
};

export type CspParseResult = {
  violations: CspViolation[];
  ignored: { extension: number; foreign: number; malformed: number };
};

const EXTENSION = /^(chrome|moz|safari|safari-web|ms-browser)-extension:/i;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function contentTypeAccepted(header: string | null): boolean {
  const type = (header ?? "").split(";")[0].trim().toLowerCase();
  return (CSP_REPORT_CONTENT_TYPES as readonly string[]).includes(type);
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Route pattern of a same-origin page: numeric / long id segments -> [id], at most 6 segments. */
export function routePattern(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean).slice(0, 6).map((s) =>
    /^\d+$/.test(s) || /^[0-9a-f-]{16,}$/i.test(s) || s.length > 40 ? "[id]" : s.replace(/[^A-Za-z0-9._~-]/g, "_"),
  );
  return "/" + segments.join("/");
}

export function classifyBlocked(blocked: string, origin: string): { blocked: CspBlockedClass; externalHost: string | null } | "extension" {
  const value = blocked.trim();
  if (!value) return { blocked: "unknown", externalHost: null };
  if (EXTENSION.test(value)) return "extension";
  const lower = value.toLowerCase();
  if (lower === "inline") return { blocked: "inline", externalHost: null };
  if (lower === "eval") return { blocked: "eval", externalHost: null };
  if (lower === "wasm-eval") return { blocked: "wasm-eval", externalHost: null };
  if (lower === "data" || lower.startsWith("data:")) return { blocked: "data", externalHost: null };
  if (lower === "blob" || lower.startsWith("blob:")) return { blocked: "blob", externalHost: null };
  if (lower === "self") return { blocked: "self", externalHost: null };
  const url = parseUrl(value);
  if (!url) return { blocked: "unknown", externalHost: null };
  if (url.origin === origin) return { blocked: "self", externalHost: null };
  const host = url.hostname.toLowerCase();
  if (host.endsWith(".supabase.co")) return { blocked: "supabase", externalHost: null };
  if (host === "accounts.google.com") return { blocked: "google", externalHost: null };
  if (host === "vercel.live" || host === "vercel.com" || host.endsWith(".pusher.com")) return { blocked: "vercel-toolbar", externalHost: null };
  if (!/^(https?|wss?):$/.test(url.protocol)) return { blocked: "unknown", externalHost: null };
  return { blocked: "external", externalHost: host.slice(0, 100) };
}

function normalizeDirective(value: string): string {
  const name = value.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return DIRECTIVES.has(name) ? name : "other";
}

type RawFields = { document: string; directive: string; blocked: string; disposition: string; sourceFile: string; line: unknown };

function fromLegacy(body: Record<string, unknown>): RawFields {
  return {
    document: str(body["document-uri"]),
    directive: str(body["effective-directive"]) || str(body["violated-directive"]),
    blocked: str(body["blocked-uri"]),
    disposition: str(body.disposition),
    sourceFile: str(body["source-file"]),
    line: body["line-number"],
  };
}

function fromReportingApi(body: Record<string, unknown>, reportUrl: string): RawFields {
  return {
    document: str(body.documentURL) || reportUrl,
    directive: str(body.effectiveDirective),
    blocked: str(body.blockedURL),
    disposition: str(body.disposition),
    sourceFile: str(body.sourceFile),
    line: body.lineNumber,
  };
}

/**
 * Parse one request body. `origin` is this deployment's own origin
 * (scheme + host the request came to); reports about any other page are dropped.
 */
export function parseCspReports(text: string, origin: string): CspParseResult {
  const result: CspParseResult = { violations: [], ignored: { extension: 0, foreign: 0, malformed: 0 } };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    result.ignored.malformed++;
    return result;
  }
  const raws: RawFields[] = [];
  const object = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const legacy = object?.["csp-report"];
  if (legacy && typeof legacy === "object") {
    // report-uri. WebKit's body also carries type "csp-violation" next to
    // "csp-report" (observed 2026-11-21), so this key is checked first.
    raws.push(fromLegacy(legacy as Record<string, unknown>));
  } else if (Array.isArray(json) || object?.type === "csp-violation") {
    // Reporting API: a batch (Chromium) or one object (WebKit).
    const list: unknown[] = Array.isArray(json) ? json : [json];
    for (const item of list.slice(0, CSP_REPORT_MAX_PER_REQUEST)) {
      const report = item as { type?: unknown; url?: unknown; body?: unknown };
      if (report?.type !== "csp-violation" || typeof report.body !== "object" || report.body === null) {
        result.ignored.malformed++;
        continue;
      }
      raws.push(fromReportingApi(report.body as Record<string, unknown>, str(report.url)));
    }
    if (list.length > CSP_REPORT_MAX_PER_REQUEST) result.ignored.malformed += list.length - CSP_REPORT_MAX_PER_REQUEST;
  } else {
    result.ignored.malformed++;
    return result;
  }

  for (const raw of raws) {
    const page = parseUrl(raw.document);
    if (!page || page.origin !== origin) {
      result.ignored.foreign++;
      continue;
    }
    if (!raw.directive) {
      result.ignored.malformed++;
      continue;
    }
    if (EXTENSION.test(raw.sourceFile)) {
      result.ignored.extension++;
      continue;
    }
    const blocked = classifyBlocked(raw.blocked, origin);
    if (blocked === "extension") {
      result.ignored.extension++;
      continue;
    }
    const source = parseUrl(raw.sourceFile);
    const line = typeof raw.line === "number" && Number.isInteger(raw.line) && raw.line >= 0 && raw.line < 10_000_000 ? raw.line : null;
    result.violations.push({
      disposition: raw.disposition.toLowerCase() === "enforce" ? "enforce" : "report",
      directive: normalizeDirective(raw.directive),
      ...blocked,
      route: routePattern(page.pathname),
      sourceFile: source && source.origin === origin ? source.pathname.slice(0, 120) : null,
      line,
    });
  }
  return result;
}

/** The only thing written to the database per violation. */
export function cspMetricName(v: Pick<CspViolation, "disposition" | "directive" | "blocked">): string {
  return `csp.${v.disposition}.${v.directive}.${v.blocked}`;
}

export const cspIgnoredMetric = (reason: keyof CspParseResult["ignored"] | "limited" | "too_large") => `csp.ignored.${reason}`;
