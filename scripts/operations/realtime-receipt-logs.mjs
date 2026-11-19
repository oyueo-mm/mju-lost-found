// Count browser receipts in a deployment's runtime logs, by digest only.
// The token route logs "Private chat browser receipt <sha256(nonce)>" when a
// member browser received a non-persistent challenge on its private topic.
// Prints counts per expected nonce; never prints log bodies.
//
//   node scripts/operations/realtime-receipt-logs.mjs dpl_xxx 15m <nonce> [<nonce>]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const [deployment, since, ...nonces] = process.argv.slice(2);
if (!/^dpl_[A-Za-z0-9]+$/.test(deployment ?? "") || !/^\d{1,2}m$/.test(since ?? "") || !nonces.length || nonces.some((n) => !/^[0-9a-f-]{36}$/i.test(n))) {
  throw new Error("usage: realtime-receipt-logs.mjs dpl_ID <N>m <nonce> [<nonce>]");
}
const r = spawnSync(`npx --no-install vercel logs ${deployment} --since ${since} --json --limit 500`, { shell: true, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
if (r.status) throw new Error("Log query failed");
const text = r.stdout;
const results = nonces.map((nonce, i) => {
  const digest = createHash("sha256").update(nonce).digest("hex");
  return { challenge: i + 1, receipts: text.split(digest).length - 1 };
});
console.log(JSON.stringify({ deployment, window: since, results }));
if (results.some((x) => x.receipts < 1)) process.exitCode = 1;
