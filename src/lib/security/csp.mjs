// D-4: Content-Security-Policy candidate (docs/operations/release-d4-plan-2026-11-16.md).
// Plain .mjs like accessPolicy.mjs / optimizationHosts.mjs: next.config.ts
// imports it, and the config must load under plain Node so the database
// access guard runs first (accessPolicy.test.ts).
//
// OFF unless MJU_CSP_MODE is "report-only" or "enforce" at BUILD time
// (next.config headers() is evaluated during the build), so this file changes
// no deployed behaviour by itself. Origins come from a read-only inventory of
// the app (2026-11-21):
//   - Supabase per environment: Storage uploads/public photos (https) and the
//     D-3 private Realtime socket (wss) -- see cspRealtime.test.ts;
//   - next/font self-hosts fonts; next/image is same-origin (/_next/image);
//   - photo previews are blob: URLs; the service worker is /sw.js;
//   - Google sign-in leaves for accounts.google.com (form-action covers a
//     form-submission redirect);
//   - no third-party scripts, iframes or avatars. Next's inline bootstrap and
//     the three layout init scripts need 'unsafe-inline' until nonces/hashes
//     are evaluated (plan step 5) -- this is NOT inline-XSS protection yet.
//   - Zod's eval probe is switched off in src/instrumentation-client.ts.
// Preview pages also load Vercel's toolbar (vercel.live); allowed on Preview only.
import { PREVIEW_DB_PROJECT, PRODUCTION_DB_PROJECT } from "../db/accessPolicy.mjs";

// Violation reports go to the same origin (src/app/api/csp-report/route.ts)
// through report-uri only. Checked 2026-11-21 in Chromium and WebKit: with
// report-uri alone both deliver at once; once report-to is also named,
// Chromium ignores report-uri and its Reporting API upload never arrived in
// the local check (and cannot be checked on protected Preview), while WebKit
// switches to a different body shape. report-uri is deprecated but still
// implemented by every engine; the endpoint already parses the Reporting API
// shapes, so report-to can be added once it is verified on HTTPS.
export const CSP_REPORT_PATH = "/api/csp-report";

/** @typedef {"off" | "report-only" | "enforce"} CspMode */
/** @typedef {Record<string, string | undefined>} Env */

/** @param {Env} [env] @returns {CspMode} */
export function cspMode(env = process.env) {
  const mode = env.MJU_CSP_MODE;
  return mode === "report-only" || mode === "enforce" ? mode : "off";
}

/** @param {Env} [env] @returns {string} */
export function buildCsp(env = process.env) {
  const production = env.VERCEL_ENV === "production";
  const preview = env.VERCEL_ENV === "preview";
  const development = env.NODE_ENV === "development";
  const supabase = production ? PRODUCTION_DB_PROJECT : PREVIEW_DB_PROJECT;
  const storage = `https://${supabase}.supabase.co`;
  const realtime = `wss://${supabase}.supabase.co`;
  const toolbar = preview ? ["https://vercel.live"] : [];
  /** @type {Array<[string, string[]]>} */
  const directives = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(development ? ["'unsafe-eval'"] : []), ...toolbar]],
    ["style-src", ["'self'", "'unsafe-inline'", ...toolbar]],
    ["img-src", ["'self'", "data:", "blob:", storage, ...(preview ? ["https://vercel.live", "https://vercel.com"] : [])]],
    ["font-src", ["'self'", "data:", ...toolbar]],
    ["connect-src", ["'self'", storage, realtime, ...(development ? ["ws:"] : []), ...(preview ? ["https://vercel.live", "wss://ws-us3.pusher.com"] : [])]],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["frame-src", preview ? toolbar : ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["form-action", ["'self'", "https://accounts.google.com"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
    ["report-uri", [CSP_REPORT_PATH]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

/** @param {Env} [env] @returns {{ key: string, value: string } | null} */
export function cspHeader(env = process.env) {
  const mode = cspMode(env);
  if (mode === "off") return null;
  return { key: mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", value: buildCsp(env) };
}

/** The CSP header as a list for next.config; [] when off. @param {Env} [env] */
export function cspHeaders(env = process.env) {
  const csp = cspHeader(env);
  return csp ? [csp] : [];
}
