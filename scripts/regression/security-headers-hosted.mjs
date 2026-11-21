// D-4: read-only check of the security response headers on a hosted deployment.
// GET/HEAD only, no cookies, no login, nothing written.
//   node scripts/regression/security-headers-hosted.mjs preview      (through `vercel curl`, Deployment Protection)
//   node scripts/regression/security-headers-hosted.mjs production   (https://mju-find.vercel.app)
// Optional: --expect-csp report-only|enforce|off (default off: no CSP header of either kind).
import { spawnSync } from "node:child_process";

const [target, ...flags] = process.argv.slice(2);
if (!["preview", "production"].includes(target)) throw new Error("Usage: security-headers-hosted.mjs preview|production [--expect-csp off|report-only|enforce]");
const i = flags.indexOf("--expect-csp");
const expectCsp = i >= 0 ? flags[i + 1] : "off";
if (!["off", "report-only", "enforce"].includes(expectCsp)) throw new Error("--expect-csp off|report-only|enforce");

const BASE = target === "production" ? "https://mju-find.vercel.app" : "https://mju-lost-found-preview.vercel.app";
const EXPECTED = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "geolocation=(), microphone=(), payment=(), usb=()",
};
// Pages, API, service worker, static asset, image optimizer, auth redirect.
const PATHS = ["/", "/login", "/lost", "/found", "/search", "/api/version", "/api/auth/session", "/api/auth/providers", "/sw.js", "/manifest.webmanifest", "/robots.txt", "/icon.svg"];

function fetchHeaders(path) {
  if (target === "production") {
    return fetch(BASE + path, { redirect: "manual", signal: AbortSignal.timeout(30000) }).then(async (r) => {
      await r.body?.cancel();
      return { status: r.status, headers: Object.fromEntries([...r.headers].map(([k, v]) => [k.toLowerCase(), v])) };
    });
  }
  if (!/^\/[A-Za-z0-9/._-]*$/.test(path)) throw new Error("Unexpected path");
  const r = spawnSync(`npx --no-install vercel curl "${path}" --deployment ${BASE} -- --silent --show-error --max-time 30 -o ${process.platform === "win32" ? "NUL" : "/dev/null"} -D -`, { shell: true, encoding: "utf8", windowsHide: true, maxBuffer: 1 << 20 });
  if (r.status) throw new Error(`vercel curl failed for ${path}`);
  const blocks = r.stdout.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b.trim()));
  const last = blocks.at(-1) ?? "";
  const [statusLine, ...lines] = last.trim().split(/\r?\n/);
  const headers = {};
  for (const line of lines) { const k = line.indexOf(":"); if (k > 0) headers[line.slice(0, k).trim().toLowerCase()] = line.slice(k + 1).trim(); }
  return Promise.resolve({ status: Number(statusLine.split(" ")[1]), headers });
}

const results = [];
for (const path of PATHS) {
  const { status, headers } = await fetchHeaders(path);
  const missing = Object.entries(EXPECTED).filter(([k, v]) => headers[k] !== v).map(([k]) => `${k}=${headers[k] ?? "(none)"}`);
  const csp = headers["content-security-policy"] ? "enforce" : headers["content-security-policy-report-only"] ? "report-only" : "off";
  const ok = status > 0 && status < 500 && missing.length === 0 && csp === expectCsp;
  results.push({ path, status, ok, missing, csp, hsts: Boolean(headers["strict-transport-security"]) });
}
const passed = results.every((r) => r.ok);
console.log(JSON.stringify({ target, base: BASE, expectCsp, passed, results }, null, 1));
if (!passed) process.exitCode = 1;
