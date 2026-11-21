import { afterEach, describe, expect, it, vi } from "vitest";

import { PREVIEW_DB_PROJECT, PRODUCTION_DB_PROJECT } from "@/lib/db/accessPolicy.mjs";
import { buildCsp, cspHeader, cspHeaders, cspMode } from "./csp.mjs";

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
const directive = (policy: string, name: string) => policy.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `))?.split(/\s+/).slice(1) ?? [];

async function headersFor(vars: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
  const { default: config } = await import("../../../next.config");
  return (await config.headers!()).flatMap((rule) => rule.headers);
}
afterEach(() => vi.unstubAllEnvs());

describe("D-4 CSP candidate", () => {
  it("is off unless MJU_CSP_MODE asks for it", () => {
    expect(cspMode(env({}))).toBe("off");
    expect(cspMode(env({ MJU_CSP_MODE: "yes" }))).toBe("off");
    expect(cspHeader(env({ VERCEL_ENV: "production" }))).toBeNull();
    expect(cspHeader(env({ MJU_CSP_MODE: "report-only" }))?.key).toBe("Content-Security-Policy-Report-Only");
    expect(cspHeader(env({ MJU_CSP_MODE: "enforce" }))?.key).toBe("Content-Security-Policy");
  });

  it("production: own Supabase only, no toolbar, no eval, Google sign-in redirect allowed", () => {
    const p = buildCsp(env({ VERCEL_ENV: "production", NODE_ENV: "production" }));
    expect(directive(p, "connect-src")).toEqual(["'self'", `https://${PRODUCTION_DB_PROJECT}.supabase.co`, `wss://${PRODUCTION_DB_PROJECT}.supabase.co`]);
    expect(directive(p, "img-src")).toEqual(["'self'", "data:", "blob:", `https://${PRODUCTION_DB_PROJECT}.supabase.co`]);
    expect(directive(p, "form-action")).toEqual(["'self'", "https://accounts.google.com"]);
    expect(p).not.toContain(PREVIEW_DB_PROJECT);
    expect(p).not.toContain("unsafe-eval");
    expect(p).not.toContain("vercel.live");
    for (const d of ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "frame-src 'none'", "worker-src 'self'", "default-src 'self'"]) expect(p).toContain(d);
    expect(directive(p, "report-uri")).toEqual(["/api/csp-report"]);
    expect(p).not.toContain("report-to");
  });

  it("reports to the same-origin endpoint through report-uri only (no Reporting-Endpoints header)", () => {
    expect(cspHeaders(env({ VERCEL_ENV: "production" }))).toEqual([]);
    const headers = cspHeaders(env({ VERCEL_ENV: "production", MJU_CSP_MODE: "report-only" }));
    expect(headers.map((h) => h.key)).toEqual(["Content-Security-Policy-Report-Only"]);
    expect(headers[0].value).toContain("report-uri /api/csp-report");
  });

  it("preview: Preview Supabase plus the Vercel toolbar only", () => {
    const p = buildCsp(env({ VERCEL_ENV: "preview", NODE_ENV: "production" }));
    expect(directive(p, "connect-src")).toContain(`wss://${PREVIEW_DB_PROJECT}.supabase.co`);
    expect(p).not.toContain(PRODUCTION_DB_PROJECT);
    expect(directive(p, "frame-src")).toEqual(["https://vercel.live"]);
  });

  it("next.config: the four base headers everywhere (Production included); the CSP only with the flag", async () => {
    const base = ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy"];
    const production = await headersFor({ VERCEL_ENV: "production" });
    expect(production.map((h) => h.key)).toEqual(base);
    expect(Object.fromEntries(production.map((h) => [h.key, h.value]))).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "geolocation=(), microphone=(), payment=(), usb=()",
    });
    expect((await headersFor({ VERCEL_ENV: "preview" })).map((h) => h.key)).toEqual(base);
    expect((await headersFor({ VERCEL_ENV: "production", MJU_CSP_MODE: "report-only" })).map((h) => h.key)).toEqual([...base, "Content-Security-Policy-Report-Only"]);
    const preview = await headersFor({ VERCEL_ENV: "preview", MJU_CSP_MODE: "report-only" });
    const previewCsp = preview.find((h) => h.key === "Content-Security-Policy-Report-Only");
    expect(previewCsp).toBeDefined();
    expect(directive(previewCsp!.value, "connect-src")).toContain(`wss://${PREVIEW_DB_PROJECT}.supabase.co`);
  });
});
