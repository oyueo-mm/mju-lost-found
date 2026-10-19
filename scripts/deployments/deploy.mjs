#!/usr/bin/env node
// Deploy with the Vercel CLI and record the deployment in 배포 이력 right
// away (scripts/deployments/record.mjs) -- including a failed build, which
// never runs and so cannot record itself.
//
//   node scripts/deployments/deploy.mjs preview [--alias]
//       vercel deploy; --alias also points mju-lost-found-preview.vercel.app at it
//   node scripts/deployments/deploy.mjs production
//       vercel deploy --prod
//   recording: the Preview database by default; after the release (its
//   DeploymentRecord migration on Production) add
//   --db both --confirm-production so both environments' 개발자 통계 see
//   every deployment.
//
// Deploy from a clean working tree: the CLI then sends the exact commit
// (meta.githubCommitSha); uncommitted changes are flagged as gitDirty and
// the dashboard says so.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PREVIEW_ALIAS } from "../../src/lib/devstats/vercelDeployment.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const run = (args, capture = false) =>
  spawnSync(["npx", ...args].join(" "), { cwd: ROOT, shell: true, encoding: "utf8", stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit", maxBuffer: 64 * 1024 * 1024 });

const [target, ...rest] = process.argv.slice(2);
if (target !== "preview" && target !== "production") {
  console.error("usage: deploy.mjs preview [--alias] | production  [--db both|production --confirm-production]");
  process.exit(2);
}
const alias = rest.includes("--alias");
const recordArgs = rest.filter((a) => a !== "--alias");

const status = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
if (status) console.warn("주의: 커밋하지 않은 변경이 있습니다. 배포는 gitDirty로 기록되고 커밋과 정확히 일치하지 않을 수 있습니다.");

const deploy = run(["vercel", "deploy", "--yes", ...(target === "production" ? ["--prod"] : [])], true);
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
process.exit(deploy.status || rec.status || 0);
