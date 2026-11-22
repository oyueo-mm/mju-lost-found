// Hosted Preview smoke (2026-11-22 hardening): one anonymous AI search, one list
// read, a page view and /busy; prints statuses and the shared AI ceiling counters'
// current values (A-4). Preview only. Sends ONE AI search (counted like any).
//   node --env-file=.env.preview.local scripts/regression/hardening-hosted.mjs <preview deployment url>
import "../db/install-guard.mjs";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import pg from "pg";
import { spawnSync } from "node:child_process";
const base = process.argv[2];
if (!/^https:\/\/mju-lost-found-vercel-[a-z0-9]+-oyueo\.vercel\.app$/.test(base ?? "") || assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview") throw new Error("usage: <preview deployment url> with the Preview env");
const project = spawnSync("npx --no-install vercel api /v9/projects/prj_zMYrrsw80l829lSjs2n2Ur6YV5eP", { shell: true, encoding: "utf8", windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 1 << 22 });
const key = Object.entries(JSON.parse(project.stdout.slice(project.stdout.indexOf("{"))).protectionBypass ?? {}).find(([, v]) => v?.scope === "automation-bypass")?.[0];
const h = { "x-vercel-protection-bypass": key };
const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();
const read = async () => Object.fromEntries((await db.query(`SELECT key, count FROM "RateLimitCounter" WHERE key LIKE 'aiSearch%Global:g:%' AND window_start >= (now() AT TIME ZONE 'UTC') - interval '1 day' ORDER BY window_start DESC`)).rows.map((r) => [r.key, r.count]));
const before = await read();
const f = new FormData(); f.set("q", "검은색 지갑");
const ai = await fetch(`${base}/api/posts?mode=ai&type=lost`, { method: "POST", body: f, headers: h });
const list = await fetch(`${base}/api/posts?type=lost`, { headers: h });
const page = await fetch(`${base}/lost`, { headers: h, redirect: "manual" });
const busy = await fetch(`${base}/busy`, { headers: h });
const after = await read();
console.log(JSON.stringify({ ai: ai.status, list: list.status, page: page.status, busy: busy.status, before, after }));
await db.end();
