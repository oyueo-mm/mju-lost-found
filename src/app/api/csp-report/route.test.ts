import { afterEach, describe, expect, it, vi } from "vitest";

const addDailyCount = vi.fn();
vi.mock("@/lib/metrics/record", () => ({ addDailyCount }));
const checkRateLimit = vi.fn(async () => ({ ok: true }) as { ok: true } | { ok: false; reason: "limited" | "unavailable"; retryAfterSeconds: number });
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit, clientIpFrom: () => "203.0.113.9" }));

const { POST } = await import("./route");
const ORIGIN = "https://mju-find.vercel.app";
const post = (body: string, type = "application/csp-report", extra: Record<string, string> = {}) =>
  POST(new Request(`${ORIGIN}/api/csp-report`, { method: "POST", body, headers: { "content-type": type, ...extra } }));
const report = (documentUri = `${ORIGIN}/lost?q=wallet`) =>
  JSON.stringify({ "csp-report": { "document-uri": documentUri, "effective-directive": "img-src", "blocked-uri": "https://cdn.example.org/a.png?sig=1", disposition: "report" } });

afterEach(() => {
  addDailyCount.mockClear();
  checkRateLimit.mockClear();
  vi.restoreAllMocks();
});

describe("POST /api/csp-report", () => {
  it("counts a same-origin violation and answers 204 with no body", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await post(report());
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(addDailyCount).toHaveBeenCalledWith("csp.report.img-src.external");
    expect(checkRateLimit).toHaveBeenCalledWith("cspReport", { ip: "203.0.113.9" });
    const logged = info.mock.calls.flat().join(" ");
    expect(logged).toContain("cdn.example.org");
    expect(logged).not.toMatch(/sig=|wallet|203\.0\.113/);
  });

  it("refuses other content types (415) without touching the database", async () => {
    expect((await post(report(), "text/plain")).status).toBe(415);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(addDailyCount).not.toHaveBeenCalled();
  });

  it("refuses bodies over 16 KiB (413) -- declared or streamed", async () => {
    const big = JSON.stringify({ "csp-report": { pad: "x".repeat(17 * 1024) } });
    expect((await post(big)).status).toBe(413);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(addDailyCount).toHaveBeenCalledWith("csp.ignored.too_large");
  });

  it("drops forged reports about another origin without a rate-limit write", async () => {
    const res = await post(report("https://evil.example/page"));
    expect(res.status).toBe(204);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(addDailyCount).toHaveBeenCalledWith("csp.ignored.foreign", 1);
  });

  it("judges 'same origin' by the Host the browser used", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const local = (doc: string, host: string) =>
      POST(new Request("http://localhost:3109/api/csp-report", { method: "POST", body: report(doc), headers: { "content-type": "application/csp-report", host } }));
    expect((await local("http://127.0.0.1:3109/", "127.0.0.1:3109")).status).toBe(204);
    expect(addDailyCount).toHaveBeenCalledWith("csp.report.img-src.external");
    addDailyCount.mockClear();
    await local("http://127.0.0.1:3109/", "other.example");
    expect(addDailyCount).toHaveBeenCalledWith("csp.ignored.foreign", 1);
  });

  it("answers 429 when the sender is over the limit, and drops quietly when the limiter is down", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    checkRateLimit.mockResolvedValueOnce({ ok: false, reason: "limited", retryAfterSeconds: 30 });
    const limited = await post(report());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("30");
    expect(addDailyCount).toHaveBeenCalledWith("csp.ignored.limited", 1);
    addDailyCount.mockClear();
    checkRateLimit.mockResolvedValueOnce({ ok: false, reason: "unavailable", retryAfterSeconds: 5 });
    expect((await post(report())).status).toBe(204);
    expect(addDailyCount).not.toHaveBeenCalled();
  });

  it("accepts the Reporting API batch format", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const body = JSON.stringify([
      { type: "csp-violation", url: `${ORIGIN}/`, body: { documentURL: `${ORIGIN}/`, effectiveDirective: "script-src-elem", blockedURL: "inline", disposition: "report" } },
      { type: "csp-violation", url: `${ORIGIN}/`, body: { documentURL: `${ORIGIN}/`, effectiveDirective: "connect-src", blockedURL: "https://x.example/api", disposition: "report" } },
    ]);
    expect((await post(body, "application/reports+json")).status).toBe(204);
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(addDailyCount.mock.calls.map((c) => c[0])).toEqual(["csp.report.script-src-elem.inline", "csp.report.connect-src.external"]);
  });
});
