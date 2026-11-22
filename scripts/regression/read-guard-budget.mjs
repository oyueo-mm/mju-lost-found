// A-5: measure how many guard-counted requests one ordinary anonymous browse
// produces on a hosted Preview deployment (read-guard-budget.py), to judge the
// per-network limit (READ_LIMITS.perNetwork) for many students behind one
// campus NAT. Anonymous GETs only; nothing is written.
//   node scripts/regression/read-guard-budget.mjs <preview deployment url>
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

const base = process.argv[2]?.replace(/\/$/, "");
if (!/^https:\/\/mju-lost-found-vercel-[a-z0-9]+-oyueo\.vercel\.app$/.test(base ?? "")) throw new Error("usage: read-guard-budget.mjs <preview deployment url>");
const project = spawnSync("npx --no-install vercel api /v9/projects/prj_zMYrrsw80l829lSjs2n2Ur6YV5eP", { shell: true, encoding: "utf8", windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 1 << 22 });
const json = JSON.parse(project.stdout.slice(project.stdout.indexOf("{")));
const key = Object.entries(json.protectionBypass ?? {}).find(([, v]) => v?.scope === "automation-bypass")?.[0] ?? "";
if (!key) throw new Error("automation bypass key unavailable");
const child = spawn("python", ["scripts/regression/read-guard-budget.py"], { stdio: ["pipe", "pipe", "inherit"], windowsHide: true, timeout: 300000 });
child.stdin.end(JSON.stringify({ base, key }));
let out = ""; child.stdout.on("data", (d) => { out += d; });
const [code] = await once(child, "close");
const r = JSON.parse(out);
const LIMIT = 600;
const minutes = Math.max(r.steps.at(-1).seconds / 60, 1 / 60);
console.log(JSON.stringify({ ...r, perMinuteThisBrowse: Math.round(r.total / minutes), concurrentBrowsersAtThisPaceUnderLimit: Math.floor(LIMIT / (r.total / minutes)) }, null, 1));
process.exit(code ?? 1);
