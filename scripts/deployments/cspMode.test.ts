import { describe, expect, it } from "vitest";

import { cspModeFromHeaders, parseHeaderBlock, resolveCspMode } from "./cspMode.mjs";

describe("resolveCspMode: Production CSP can't be switched off by accident", () => {
  it("refuses a production deploy without --csp-mode", () => {
    const r = resolveCspMode("production", []);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("--csp-mode=report-only");
  });

  it("accepts report-only for production", () => {
    expect(resolveCspMode("production", ["--csp-mode=report-only"])).toEqual({ ok: true, mode: "report-only" });
  });

  it("needs a second flag for enforce and for off", () => {
    expect(resolveCspMode("production", ["--csp-mode=enforce"]).ok).toBe(false);
    expect(resolveCspMode("production", ["--csp-mode=enforce", "--confirm-csp-enforce"])).toEqual({ ok: true, mode: "enforce" });
    expect(resolveCspMode("production", ["--csp-mode=off"]).ok).toBe(false);
    expect(resolveCspMode("production", ["--csp-mode=off", "--allow-csp-off"])).toEqual({ ok: true, mode: "off" });
  });

  it("rejects unknown and repeated modes", () => {
    expect(resolveCspMode("production", ["--csp-mode=report"]).ok).toBe(false);
    expect(resolveCspMode("production", ["--csp-mode=report-only", "--csp-mode=enforce"]).ok).toBe(false);
    expect(resolveCspMode("preview", ["--csp-mode=bogus"]).ok).toBe(false);
  });

  it("keeps Preview optional (default off)", () => {
    expect(resolveCspMode("preview", [])).toEqual({ ok: true, mode: "off" });
    expect(resolveCspMode("preview", ["--csp-mode=report-only"])).toEqual({ ok: true, mode: "report-only" });
  });
});

describe("reading the mode back from a deployment", () => {
  const block = (extra: string) => `HTTP/2 200\r\ncontent-type: text/html\r\n${extra}x-frame-options: DENY\r\n\r\n`;

  it("classifies header blocks", () => {
    expect(cspModeFromHeaders(parseHeaderBlock(block("content-security-policy-report-only: default-src 'self'\r\n")))).toBe("report-only");
    expect(cspModeFromHeaders(parseHeaderBlock(block("Content-Security-Policy: default-src 'self'\r\n")))).toBe("enforce");
    expect(cspModeFromHeaders(parseHeaderBlock(block("")))).toBe("off");
    expect(cspModeFromHeaders(parseHeaderBlock(block("content-security-policy: a\r\ncontent-security-policy-report-only: b\r\n")))).toBe("both");
  });

  it("works on a Headers object", () => {
    expect(cspModeFromHeaders(new Headers({ "Content-Security-Policy-Report-Only": "x" }))).toBe("report-only");
  });
});
