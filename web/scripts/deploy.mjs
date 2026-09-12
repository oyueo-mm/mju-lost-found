// 배포: node scripts/deploy.mjs
// 프로덕션 배포 후 깔끔한 주소(mju-lostfound.vercel.app)를 새 배포로 연결.
import { execSync } from "node:child_process";

const PUBLIC_ALIAS = "mju-lostfound.vercel.app";

console.log("배포 중…");
const out = execSync("npx --yes vercel deploy --prod --yes", { encoding: "utf8" });
const url = (out.match(/https:\/\/[a-z0-9-]+-unttle\.vercel\.app/g) || []).pop();
if (!url) {
  console.error("배포 URL 을 찾지 못했어요:\n", out);
  process.exit(1);
}
console.log("새 배포:", url);

execSync(`npx --yes vercel alias set ${url} ${PUBLIC_ALIAS}`, { stdio: "inherit" });
console.log(`\n✅ https://${PUBLIC_ALIAS}`);
