import { afterEach, describe, expect, it, vi } from "vitest";

import { PREVIEW_DB_PROJECT, PRODUCTION_DB_PROJECT } from "@/lib/db/accessPolicy.mjs";

// D-3 private chat opens wss://<project>.supabase.co/realtime/v1 from the
// browser, and photo uploads PUT to https://<project>.supabase.co/storage.
// D-4 has not shipped a CSP yet. This guard fails the day a CSP (enforced or
// Report-Only) is added without those origins, before it can silently push
// every chat tab into polling.
async function headersFor(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const { default: config } = await import("../../../next.config");
  return (await config.headers!()).flatMap((rule) => rule.headers);
}

function connectSrc(policy: string): string[] {
  const directive = policy.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src"));
  return directive ? directive.split(/\s+/).slice(1) : [];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CSP stays compatible with private Realtime", () => {
  for (const [env, project] of [["production", PRODUCTION_DB_PROJECT], ["preview", PREVIEW_DB_PROJECT]] as const) {
    it(`${env}: any CSP allows the Realtime socket and Storage uploads`, async () => {
      const headers = await headersFor({ VERCEL_ENV: env });
      const policies = headers.filter((h) => /^content-security-policy(-report-only)?$/i.test(h.key));
      for (const policy of policies) {
        const sources = connectSrc(policy.value);
        // no connect-src => falls back to default-src; require it explicitly
        expect(sources.length, `${policy.key} must declare connect-src`).toBeGreaterThan(0);
        expect(sources.some((s) => s === `wss://${project}.supabase.co` || s === "wss://*.supabase.co")).toBe(true);
        expect(sources.some((s) => s === `https://${project}.supabase.co` || s === "https://*.supabase.co")).toBe(true);
      }
      // today: no CSP at all, so nothing can block the socket. Delete this
      // line in the D-4 change that introduces a CSP; the loop above stays.
      expect(policies).toHaveLength(0);
    });
  }
});
