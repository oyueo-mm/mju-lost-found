// P-2/P-3 on a hosted Preview deployment (Vercel's real Host/Origin handling).
// Anonymous only: no session, nothing written (every request stops at the
// origin check or at authentication).
//
//   node scripts/regression/csrf-hosted.mjs https://mju-lost-found-vercel-xxxx-oyueo.vercel.app
//
// Deployment Protection: the project's automation-bypass key is read through
// the Vercel CLI and only ever sent as a header -- never printed.
// The same-origin cases must reach authentication (401), proving the check
// does not refuse real same-origin traffic behind Vercel's proxy; the foreign
// cases must stop at 403. Then real browsers repeat both from a page on the
// deployment and from an attacker page (csrf-hosted.py).
import { spawnSync, spawn } from "node:child_process";
import { once } from "node:events";

const base = process.argv[2]?.replace(/\/$/, "");
if (!/^https:\/\/mju-lost-found-vercel-[a-z0-9]+-oyueo\.vercel\.app$/.test(base ?? "")) throw new Error("usage: csrf-hosted.mjs <preview deployment url>");

const project = spawnSync("npx --no-install vercel api /v9/projects/prj_zMYrrsw80l829lSjs2n2Ur6YV5eP", { shell: true, encoding: "utf8", windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 1 << 22 });
const json = JSON.parse(project.stdout.slice(project.stdout.indexOf("{")));
const key = Object.entries(json.protectionBypass ?? {}).find(([, v]) => v?.scope === "automation-bypass")?.[0];
if (!key) throw new Error("automation bypass key unavailable");

const checks = [];
const call = async (method, path, headers = {}, body) => {
  const res = await fetch(base + path, { method, redirect: "manual", headers: { "x-vercel-protection-bypass": key, ...headers }, body });
  await res.arrayBuffer().catch(() => {});
  return res.status;
};
const evil = { origin: "https://evil.example" };
const xsite = { "sec-fetch-site": "cross-site", ...evil };
const own = { "sec-fetch-site": "same-origin", origin: base };
const jsonType = { "content-type": "application/json" };
const body = JSON.stringify({ upToMessageId: 1 });
const cases = [
  ["POST read, cross-site", "POST", "/api/chat/1/read", { ...jsonType, ...xsite }, body, 403],
  ["POST read, foreign Origin only", "POST", "/api/chat/1/read", { ...jsonType, ...evil }, body, 403],
  ["POST read, another vercel.app origin", "POST", "/api/chat/1/read", { ...jsonType, origin: "https://mju-find.vercel.app" }, body, 403],
  ["POST read, same-origin -> reaches auth", "POST", "/api/chat/1/read", { ...jsonType, ...own }, body, 401],
  ["POST read, no browser headers -> reaches auth", "POST", "/api/chat/1/read", jsonType, body, 401],
  ["POST posts, cross-site", "POST", "/api/posts", { ...jsonType, ...xsite }, "{}", 403],
  ["POST posts, same-origin -> reaches auth", "POST", "/api/posts", { ...jsonType, ...own }, "{}", 401],
  ["DELETE notification, cross-site", "DELETE", "/api/notifications/1", xsite, undefined, 403],
  ["GET messages, cross-site -> reaches auth (GET never refused)", "GET", "/api/chat/1/messages", { "sec-fetch-site": "cross-site" }, undefined, 401],
];
for (const [name, method, path, headers, b, expected] of cases) {
  const status = await call(method, path, headers, b);
  checks.push({ name, ok: status === expected, status, expected });
}

const browser = spawn("python", ["scripts/regression/csrf-hosted.py"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, timeout: 180000 });
browser.stdin.end(JSON.stringify({ base, key }));
let out = ""; browser.stdout.on("data", (d) => { out += d; }); browser.stderr.resume();
const [code] = await once(browser, "close");
let browserResult = null; try { browserResult = JSON.parse(out); } catch {}
checks.push({ name: "browsers: same-origin 401, attacker page 403 (Chromium + WebKit)", ok: code === 0 && browserResult?.passed === true, browser: browserResult });

const passed = checks.every((c) => c.ok);
console.log(JSON.stringify({ suite: "csrf-hosted", base, passed, total: checks.length, failed: checks.filter((c) => !c.ok).length, checks }, null, 1));
process.exit(passed ? 0 : 1);
