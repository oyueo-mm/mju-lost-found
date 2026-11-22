#!/usr/bin/env node
// Production rollback with the safety rules of rollbackPolicy.mjs.
//
//   node scripts/deployments/rollback.mjs <dpl_… | deployment URL> --confirm-production [--dry-run]
//
// 1. resolves the target (vercel inspect): id, target, state, URL;
// 2. reads its commit from its own /api/version (vercel curl, so Deployment
//    Protection is respected) and checks it contains the database TLS code;
// 3. refuses forbidden targets (and, once SSL is enforced, pre-TLS ones);
// 4. `vercel rollback`, then confirms mju-find.vercel.app serves the target.
// No database access. Prints ids, states and commits only.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkRollbackTarget, FIRST_TLS_COMMIT } from "./rollbackPolicy.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scope = JSON.parse(readFileSync(join(ROOT, ".vercel/project.json"), "utf8")).orgId;
const [arg, ...flags] = process.argv.slice(2);
if (!arg || !flags.includes("--confirm-production") || /["\s`$]/.test(arg)) {
  console.error("usage: rollback.mjs <dpl_… | deployment URL> --confirm-production [--dry-run]");
  process.exit(2);
}
const sh = (cmd) => spawnSync(cmd, { cwd: ROOT, shell: true, encoding: "utf8", windowsHide: true, maxBuffer: 8 << 20 });

const inspect = sh(`npx --no-install vercel inspect ${arg} --scope ${scope}`);
const text = `${inspect.stdout}\n${inspect.stderr}`;
const id = /\bid\s+(dpl_[A-Za-z0-9]+)/.exec(text)?.[1] ?? null;
const url = /\burl\s+(https:\/\/[a-z0-9-]+\.vercel\.app)/.exec(text)?.[1] ?? null;
const target = /\btarget\s+(\w+)/.exec(text)?.[1] ?? null;
const state = /\bstatus\s+\S*\s*(READY|ERROR|BUILDING|QUEUED|CANCELED|INITIALIZING)/i.exec(text)?.[1]?.toUpperCase() ?? null;

let sha = null, hasTlsCode = null;
if (url) {
  const v = sh(`npx --no-install vercel curl "/api/version" --deployment ${url} --scope ${scope} -- --silent --max-time 30`);
  try { sha = JSON.parse(v.stdout.trim().split(/\r?\n/).at(-1)).gitSha ?? null; } catch { /* unknown */ }
  if (/^[a-f0-9]{40}$/.test(sha ?? "")) hasTlsCode = spawnSync("git", ["merge-base", "--is-ancestor", FIRST_TLS_COMMIT, sha], { cwd: ROOT }).status === 0;
}
const verdict = checkRollbackTarget({ id, target, state, hasTlsCode });
console.log(JSON.stringify({ id, url, target, state, gitSha: sha, hasTlsCode, verdict }, null, 1));
if (!verdict.ok) { console.error(`rollback refused: ${verdict.reason}`); process.exit(1); }
if (flags.includes("--dry-run")) { console.log("dry run: not rolled back"); process.exit(0); }

const r = spawnSync(`npx --no-install vercel rollback ${url} --yes --scope ${scope}`, { cwd: ROOT, shell: true, stdio: "inherit", windowsHide: true });
if (r.status !== 0) process.exit(r.status ?? 1);
const live = await fetch("https://mju-find.vercel.app/api/version", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
console.log(live?.deploymentId === id ? `mju-find.vercel.app = ${id}` : `확인 필요: 도메인이 ${live?.deploymentId ?? "확인 실패"}을(를) 가리킵니다`);
console.log("다음 Production 배포는 자동 승격되지 않습니다(deploy.mjs가 알려 줌). 필요하면 `vercel promote`.");
process.exit(live?.deploymentId === id ? 0 : 3);
