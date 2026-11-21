import { describe, expect, it } from "vitest";

import { classifyBlocked, contentTypeAccepted, cspMetricName, parseCspReports, routePattern, CSP_REPORT_MAX_PER_REQUEST } from "./cspReport";

const ORIGIN = "https://mju-find.vercel.app";
const legacy = (r: Record<string, unknown>) => JSON.stringify({ "csp-report": r });
const reporting = (bodies: Record<string, unknown>[]) => JSON.stringify(bodies.map((body) => ({ type: "csp-violation", age: 1, url: `${ORIGIN}/lost?q=x`, user_agent: "UA", body })));

describe("CSP report parsing (D-4)", () => {
  it("accepts only report content types", () => {
    expect(contentTypeAccepted("application/csp-report")).toBe(true);
    expect(contentTypeAccepted("application/reports+json; charset=utf-8")).toBe(true);
    expect(contentTypeAccepted("application/json")).toBe(true);
    for (const t of [null, "text/plain", "multipart/form-data", "application/x-www-form-urlencoded"]) expect(contentTypeAccepted(t)).toBe(false);
  });

  it("report-uri format: keeps only directive, class, route pattern -- no query, token or full URL", () => {
    const r = parseCspReports(legacy({
      "document-uri": `${ORIGIN}/post/182?type=found&token=secret`,
      "violated-directive": "img-src",
      "effective-directive": "img-src",
      "blocked-uri": "https://tracker.example.com/p.gif?uid=42",
      disposition: "report",
      "source-file": `${ORIGIN}/_next/static/chunks/app.js?v=1`,
      "line-number": 12,
      "script-sample": "secret sample",
    }), ORIGIN);
    expect(r.ignored).toEqual({ extension: 0, foreign: 0, malformed: 0 });
    expect(r.violations).toEqual([{ disposition: "report", directive: "img-src", blocked: "external", externalHost: "tracker.example.com", route: "/post/[id]", sourceFile: "/_next/static/chunks/app.js", line: 12 }]);
    expect(JSON.stringify(r)).not.toMatch(/secret|token|uid=|type=found|\?/);
    expect(cspMetricName(r.violations[0])).toBe("csp.report.img-src.external");
  });

  it("Reporting API format (report-to): batched array, camelCase", () => {
    const r = parseCspReports(reporting([
      { documentURL: `${ORIGIN}/search`, effectiveDirective: "script-src-elem", blockedURL: "inline", disposition: "report" },
      { documentURL: `${ORIGIN}/`, effectiveDirective: "connect-src", blockedURL: "wss://abc.supabase.co/realtime/v1/websocket?apikey=k", disposition: "enforce" },
      { documentURL: `${ORIGIN}/login`, effectiveDirective: "form-action", blockedURL: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x", disposition: "report" },
      { documentURL: `${ORIGIN}/`, effectiveDirective: "script-src", blockedURL: "eval", disposition: "report" },
    ]), ORIGIN);
    expect(r.violations.map(cspMetricName)).toEqual([
      "csp.report.script-src-elem.inline",
      "csp.enforce.connect-src.supabase",
      "csp.report.form-action.google",
      "csp.report.script-src.eval",
    ]);
    expect(JSON.stringify(r)).not.toMatch(/apikey|client_id/);
  });

  it("WebKit's report-uri body: type csp-violation AND csp-report together (observed)", () => {
    const r = parseCspReports(JSON.stringify({ type: "csp-violation", url: `${ORIGIN}/lost`, "csp-report": { "document-uri": `${ORIGIN}/lost`, referrer: "", "violated-directive": "connect-src", "effective-directive": "connect-src", "original-policy": "...", "blocked-uri": "https://x.invalid/f", "status-code": 200 } }), ORIGIN);
    expect(r.ignored).toEqual({ extension: 0, foreign: 0, malformed: 0 });
    expect(r.violations.map(cspMetricName)).toEqual(["csp.report.connect-src.external"]);
  });

  it("WebKit's single Reporting API object (sent as application/csp-report)", () => {
    const r = parseCspReports(JSON.stringify({ type: "csp-violation", url: `${ORIGIN}/`, body: { documentURL: `${ORIGIN}/`, disposition: "report", effectiveDirective: "img-src", blockedURL: "https://x.invalid:443/a.png?s=1", originalPolicy: "...", statusCode: 200, sample: "" } }), ORIGIN);
    expect(r.violations.map(cspMetricName)).toEqual(["csp.report.img-src.external"]);
    expect(r.violations[0].externalHost).toBe("x.invalid");
  });

  it("drops reports about another origin's page and extension noise", () => {
    const r = parseCspReports(reporting([
      { documentURL: "https://evil.example/", effectiveDirective: "img-src", blockedURL: "https://x.example/a.png", disposition: "report" },
      { documentURL: `${ORIGIN}/`, effectiveDirective: "script-src", blockedURL: "chrome-extension://abcdefghijklmnop/inject.js", disposition: "report" },
      { documentURL: `${ORIGIN}/`, effectiveDirective: "style-src", blockedURL: "inline", sourceFile: "moz-extension://1234/content.js", disposition: "report" },
      { documentURL: `${ORIGIN}/`, effectiveDirective: "", blockedURL: "inline", disposition: "report" },
    ]), ORIGIN);
    expect(r.violations).toEqual([]);
    expect(r.ignored).toEqual({ extension: 2, foreign: 1, malformed: 1 });
  });

  it("rejects malformed bodies and caps the batch size", () => {
    expect(parseCspReports("not json", ORIGIN).ignored.malformed).toBe(1);
    expect(parseCspReports(JSON.stringify({ hello: 1 }), ORIGIN).ignored.malformed).toBe(1);
    expect(parseCspReports(JSON.stringify([{ type: "deprecation", body: {} }]), ORIGIN).ignored.malformed).toBe(1);
    const many = Array.from({ length: CSP_REPORT_MAX_PER_REQUEST + 5 }, () => ({ documentURL: `${ORIGIN}/`, effectiveDirective: "img-src", blockedURL: "data", disposition: "report" }));
    const r = parseCspReports(reporting(many), ORIGIN);
    expect(r.violations).toHaveLength(CSP_REPORT_MAX_PER_REQUEST);
    expect(r.ignored.malformed).toBe(5);
  });

  it("keeps the counter names in a bounded set", () => {
    const r = parseCspReports(reporting([
      { documentURL: `${ORIGIN}/`, effectiveDirective: "made-up-directive-" + "x".repeat(500), blockedURL: "https://a.example/" + "y".repeat(5000), disposition: "whatever" },
    ]), ORIGIN);
    expect(cspMetricName(r.violations[0])).toBe("csp.report.other.external");
    expect(r.violations[0].externalHost).toBe("a.example");
  });

  it("route patterns hide ids and odd segments", () => {
    expect(routePattern("/post/123")).toBe("/post/[id]");
    expect(routePattern("/chat/8f14e45f-ceea-467a-9575-1234567890ab")).toBe("/chat/[id]");
    expect(routePattern("/a/b/c/d/e/f/g/h")).toBe("/a/b/c/d/e/f");
    expect(routePattern("/search/%ED%95%9C")).toBe("/search/_ED_95_9C");
  });

  it("classifies blocked resources", () => {
    expect(classifyBlocked("", ORIGIN)).toEqual({ blocked: "unknown", externalHost: null });
    expect(classifyBlocked(`${ORIGIN}/_next/image?url=x`, ORIGIN)).toEqual({ blocked: "self", externalHost: null });
    expect(classifyBlocked("blob:https://mju-find.vercel.app/uuid", ORIGIN)).toEqual({ blocked: "blob", externalHost: null });
    expect(classifyBlocked("data:image/png;base64,AAAA", ORIGIN)).toEqual({ blocked: "data", externalHost: null });
    expect(classifyBlocked("https://vercel.live/_next-live/feedback.js", ORIGIN)).toEqual({ blocked: "vercel-toolbar", externalHost: null });
    expect(classifyBlocked("safari-web-extension://x/y.js", ORIGIN)).toBe("extension");
    expect(classifyBlocked("javascript:alert(1)", ORIGIN)).toEqual({ blocked: "unknown", externalHost: null });
  });
});
