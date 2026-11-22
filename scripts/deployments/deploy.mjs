#!/usr/bin/env node
// Deploy with the Vercel CLI and record the deployment in 배포 이력 right
// away (scripts/deployments/record.mjs) -- including a failed build, which
// never runs and so cannot record itself.
//
//   node scripts/deployments/deploy.mjs preview [--alias]
//       vercel deploy; --alias also points mju-lost-found-preview.vercel.app at it
//   node scripts/deployments/deploy.mjs production
//       vercel deploy --prod
//   --approval-reference <REF>  REQUIRED for production: the operator's approval
//       reference for this release. Used to run the read-only Production
//       schema compatibility check (prisma-client-check.mjs database) through
//       scripts/db/approved-operation.mjs BEFORE anything is uploaded.
//   --csp-mode=report-only|enforce|off  (D-4) build this one deployment with
//       MJU_CSP_MODE (a build-time env: next.config bakes the header in).
//       REQUIRED for production (scripts/deployments/cspMode.mjs): the live
//       mode is report-only; enforce also needs --confirm-csp-enforce and off
//       needs --allow-csp-off. After the deploy the deployment's own headers
//       are read back (vercel curl) and a mismatch fails the command.
//       Preview: optional, default off.
//   recording: the Preview database by default; after the release (its
//   DeploymentRecord migration on Production) add
//   --db both --confirm-production so both environments' 개발 통계 see
//   every deployment.
//
// Deploy from a clean working tree: the CLI then sends the exact commit
// (meta.githubCommitSha); uncommitted changes are flagged as gitDirty and
// the dashboard says so.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PREVIEW_ALIAS } from "../../src/lib/devstats/vercelDeployment.mjs";
import { cspModeFromHeaders, parseHeaderBlock, resolveCspMode } from "./cspMode.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// The CLI's remembered default scope can differ from the linked project.
// Use the existing link; do not change login, team membership or permissions.
const scope=JSON.parse(readFileSync(join(ROOT,".vercel/project.json"),"utf8")).orgId;
if(!/^team_[A-Za-z0-9]+$/.test(scope??""))throw new Error("Valid linked Vercel team required");
const run = (args, capture = false) =>
  spawnSync(["npx", ...args,"--scope",scope].join(" "), { cwd: ROOT, shell: true, encoding: "utf8", stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit", maxBuffer: 64 * 1024 * 1024 });

const [target, ...rest] = process.argv.slice(2);
if (target !== "preview" && target !== "production") {
  console.error("usage: deploy.mjs preview [--alias] [--csp-mode=...] | production --csp-mode=report-only|enforce|off  [--db both|production --confirm-production]");
  process.exit(2);
}
// --dry-run used to be forwarded to the recorder only, so
// `deploy.mjs production --dry-run` really deployed to Production. It now means
// what it says: print the plan and exit without calling Vercel or any database.
// The recorder's own "write nothing" mode is --record-dry-run.
const KNOWN = new Set(["--alias", "--dry-run", "--record-dry-run", "--confirm-production", "--db", "--confirm-csp-enforce", "--allow-csp-off", "--approval-reference"]);
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === "--db" || a === "--approval-reference") { i++; continue; }
  if (!KNOWN.has(a) && !a.startsWith("--realtime-canary-room=") && !a.startsWith("--csp-mode=")) {
    console.error(`unknown option: ${a}`);
    process.exit(2);
  }
}
const dryRun = rest.includes("--dry-run");
const approvalReference = rest.includes("--approval-reference") ? rest[rest.indexOf("--approval-reference") + 1] : undefined;
if (target === "production" && !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{2,159}$/.test(approvalReference ?? "") ) {
  console.error("production requires --approval-reference <REF> (runs the read-only Production schema compatibility check before upload)");
  process.exit(2);
}
const alias = rest.includes("--alias");
const canaryFlags = rest.filter((arg) => arg === "--realtime-canary-room" || arg.startsWith("--realtime-canary-room="));
const canaryRoom = canaryFlags[0]?.slice("--realtime-canary-room=".length);
const csp = resolveCspMode(target, rest);
if (!csp.ok) {
  console.error(csp.error);
  process.exit(2);
}
const cspMode = csp.mode;
if (canaryFlags.length > 1 || (canaryRoom !== undefined && (!/^[1-9]\d{0,9}$/.test(canaryRoom) || Number(canaryRoom) > 2147483647))) {
  throw new Error("The Realtime canary room must be one positive room ID");
}
const recordArgs = rest
  .filter((a, i) => a !== "--approval-reference" && rest[i - 1] !== "--approval-reference")
  .filter((a) => a !== "--alias" && a !== "--dry-run" && a !== "--confirm-csp-enforce" && a !== "--allow-csp-off" && !a.startsWith("--realtime-canary-room=") && !a.startsWith("--csp-mode="))
  .map((a) => (a === "--record-dry-run" ? "--dry-run" : a));

if (dryRun) {
  console.log(JSON.stringify({
    dryRun: true,
    wouldDeploy: target,
    alias: alias && target === "preview",
    realtimeCanaryRoom: canaryRoom ?? null,
    cspMode,
    recorderArgs: recordArgs,
    note: "Nothing was deployed or recorded. Remove --dry-run to deploy.",
  }, null, 2));
  process.exit(0);
}

const status = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
if (status) console.warn("주의: 커밋하지 않은 변경이 있습니다. 배포는 gitDirty로 기록되고 커밋과 정확히 일치하지 않을 수 있습니다.");

// The generated Prisma client (src/generated/prisma) is gitignored but IS
// uploaded, and `next build` does not regenerate it. A client generated on
// another branch once went to Production (2026-11-22): it selected a column
// that only that branch's migration adds, and logged-in requests failed.
// Always regenerate from THIS checkout's schema before uploading.
const generate = spawnSync("npx --no-install prisma generate --config prisma7.config.ts", { cwd: ROOT, shell: true, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
if (generate.status !== 0) {
  console.error("prisma generate failed -- nothing was deployed");
  process.exit(1);
}
console.log("Prisma client regenerated from prisma/schema.prisma of this checkout");

// Gate 1: the client that will be uploaded IS this checkout's schema.
// Gate 2: every table/column/enum value it uses exists in the target database
// (read-only metadata; Production through the approved launcher).
const checkClient = spawnSync(process.execPath, [join(ROOT, "scripts/deployments/prisma-client-check.mjs"), "client"], { cwd: ROOT, stdio: "inherit" });
if (checkClient.status !== 0) {
  console.error("generated Prisma client does not match this checkout's schema -- nothing was deployed");
  process.exit(1);
}
const checkDb = target === "production"
  ? spawnSync(process.execPath, [join(ROOT, "scripts/db/approved-operation.mjs"), "--confirm-production", "--approval-reference", approvalReference, "--", "scripts/deployments/prisma-client-check.mjs", "database"], { cwd: ROOT, stdio: "inherit" })
  : existsSync(join(ROOT, ".env.preview.local"))
    ? spawnSync(process.execPath, ["--env-file=.env.preview.local", join(ROOT, "scripts/deployments/prisma-client-check.mjs"), "database"], { cwd: ROOT, stdio: "inherit" })
    : (console.warn("주의: .env.preview.local이 없어 Preview DB 호환성 검사를 건너뜁니다."), { status: 0 });
if (checkDb.status !== 0) {
  console.error(`the Prisma client is not compatible with the ${target} database (missing table/column/enum value) -- nothing was deployed. Apply the release's migration first, or deploy the matching code.`);
  process.exit(1);
}

const deploy = run([
  "vercel", "deploy", "--yes",
  ...(target === "production" ? ["--prod"] : []),
  ...(canaryRoom ? ["--env", `MJU_REALTIME_CANARY_ROOM_ID=${canaryRoom}`] : []),
  ...(cspMode !== "off" ? ["--build-env", `MJU_CSP_MODE=${cspMode}`] : []),
], true);
process.stdout.write(deploy.stdout ?? "");
const url = /https:\/\/[a-z0-9-]+-[a-z0-9]{9}-oyueo\.vercel\.app/.exec(deploy.stdout ?? "")?.[0];
if (!url) {
  console.error("배포 URL을 찾지 못했습니다. `vercel ls`로 생성 여부를 확인한 뒤 record.mjs로 기록하세요.");
  process.exit(1);
}
if (alias && target === "preview" && deploy.status === 0) {
  const a = run(["vercel", "alias", "set", url, PREVIEW_ALIAS]);
  if (a.status !== 0) console.error("별칭 지정 실패: 배포만 기록합니다.");
}
// recorded even when the build failed (its state says so)
const rec = spawnSync(process.execPath, [join(ROOT, "scripts/deployments/record.mjs"), url, ...recordArgs], { cwd: ROOT, stdio: "inherit" });
// Read the new deployment's own headers back (Deployment Protection: vercel
// curl). A production deployment is already live here, so a mismatch is
// reported loudly with the rollback hint rather than silently accepted.
let cspCheck = 0;
if (deploy.status === 0) {
  const head = spawnSync(`npx --no-install vercel curl "/" --deployment ${url} --scope ${scope} -- --silent --show-error --max-time 30 -o ${process.platform === "win32" ? "NUL" : "/dev/null"} -D -`, { cwd: ROOT, shell: true, encoding: "utf8", windowsHide: true, maxBuffer: 1 << 20 });
  const live = head.status === 0 ? cspModeFromHeaders(parseHeaderBlock(head.stdout ?? "")) : null;
  if (live === cspMode) console.log(`CSP 확인: ${url} = ${live}`);
  else {
    cspCheck = 1;
    console.error(`CSP 불일치: 요청 ${cspMode}, 배포 응답 ${live ?? "확인 실패"}.${target === "production" ? " Production이 이미 바뀌었습니다. 의도와 다르면 직전 배포로 vercel rollback 하세요." : ""}`);
  }
}
// After `vercel rollback`, Vercel stops assigning the production domains to
// new production deployments until one is promoted (2026-11-22). Say so
// instead of letting a "successful" deploy silently not serve traffic.
let domainCheck = 0;
const deploymentId = /"id":\s*"(dpl_[A-Za-z0-9]+)"/.exec(deploy.stdout ?? "")?.[1];
if (target === "production" && deploy.status === 0 && deploymentId) {
  const live = await fetch("https://mju-find.vercel.app/api/version", { cache: "no-store", signal: AbortSignal.timeout(20000) }).then((r) => r.json()).catch(() => null);
  if (live?.deploymentId === deploymentId) console.log(`도메인 확인: mju-find.vercel.app = ${deploymentId}`);
  else {
    domainCheck = 3;
    console.error(`도메인이 새 배포를 가리키지 않습니다(현재 ${live?.deploymentId ?? "확인 실패"}). 직전에 롤백했다면 확인 후 \`vercel promote ${url}\`로 승격하세요.`);
  }
}
process.exit(deploy.status || rec.status || cspCheck || domainCheck || 0);
