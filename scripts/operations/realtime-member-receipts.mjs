// Reports matching authenticated browser receipts from Vercel logs.
// The caller supplies SHA-256 digests of operator challenges, never a token.
import { spawnSync } from "node:child_process";

const [deployment, ...digests] = process.argv.slice(2);
if (!/^dpl_[A-Za-z0-9]+$/.test(deployment ?? "") ||
    !digests.length || digests.length > 4 || digests.some(digest => !/^[a-f0-9]{64}$/.test(digest))) {
  throw new Error("Expected a deployment ID and one to four receipt digests");
}

const result = spawnSync(
  `npx --no-install vercel logs ${deployment} --since 10m --limit 200 --json --query "Private chat browser receipt"`,
  { shell: true, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 30000 },
);
if (result.status !== 0) throw new Error("Receipt log query failed");
const rows = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const matching = digests.map(digest => rows.some(row =>
  typeof row.message === "string" && row.message.trim() === `Private chat browser receipt ${digest}`
));
console.log(JSON.stringify({ deployment, matching }));
if (!matching.every(Boolean)) process.exitCode = 1;
