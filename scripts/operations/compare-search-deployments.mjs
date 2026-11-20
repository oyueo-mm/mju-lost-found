// Compare normal, non-persistent searches between two Preview deployments on
// the same database: keyword, semantic, unified (lost and found, several
// queries) and image (both types). Each result list is hashed with ids AND
// displayed scores, so any change of rank or score shows up. AI searches are
// spaced to stay under the anonymous aiSearch limit (20/min).
//   node scripts/operations/compare-search-deployments.mjs dpl_<old> dpl_<new>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const ids = process.argv.slice(2);
if (ids.length !== 2 || ids.some((id) => !/^dpl_[A-Za-z0-9]+$/.test(id))) throw new Error("Two explicit deployments required");
function vercelApi(path) {
  const out = execFileSync("npx", ["--no-install", "vercel", "api", path, "--scope", "oyueo"], { encoding: "utf8", shell: true, windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  return JSON.parse(out.slice(out.indexOf("{")));
}
const deployments = ids.map((id) => {
  const d = vercelApi(`/v13/deployments/${id}`);
  if (d.readyState !== "READY" || d.target === "production" || !/^mju-lost-found-vercel-[a-z0-9]{9}-oyueo\.vercel\.app$/.test(d.url)) throw new Error("Ready Preview deployments only");
  return { id, url: d.url };
});
const bypass = Object.keys(vercelApi("/v9/projects/prj_zMYrrsw80l829lSjs2n2Ur6YV5eP").protectionBypass ?? {})[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const queries = ["지갑", "에어팟", "학생증 카드", "검은색 우산"];
const photo = readFileSync("docs/ai-eval-seed/query-images/R12.jpg");
const hash = (items) => createHash("sha256").update(JSON.stringify(items.map((i) => [i.type, i.id, i.score ?? null]))).digest("hex").slice(0, 16);
async function run(d, mode, type, q) {
  // A 429 is this script hitting the anonymous AI-search limit, not a result:
  // wait for the window and ask again (never compared as a result).
  for (let attempt = 0; ; attempt++) {
    const result = await runOnce(d, mode, type, q);
    if (result.status !== 429 || attempt === 3) return result;
    await sleep(30000);
  }
}
async function runOnce(d, mode, type, q) {
  const started = Date.now();
  const init = { headers: { "x-vercel-protection-bypass": bypass } };
  let url = `https://${d.url}/api/posts?type=${type}&mode=${mode}&limit=10`;
  if (mode === "image") { const form = new FormData(); form.set("image", new Blob([photo], { type: "image/jpeg" }), "query.jpg"); Object.assign(init, { method: "POST", body: form }); }
  else url += `&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, init);
  const j = await r.json().catch(() => null);
  const items = j?.data ?? [];
  return { status: r.status, count: items.length, hash: hash(items), ms: Date.now() - started };
}
const cases = [];
for (const type of ["lost", "found"]) {
  for (const q of queries) for (const mode of ["keyword", "semantic", "unified"]) cases.push({ mode, type, q });
  cases.push({ mode: "image", type, q: "R12.jpg" });
}
const rows = [];
for (const c of cases) {
  const pair = [];
  for (const d of deployments) {
    pair.push(await run(d, c.mode, c.type, c.q));
    if (c.mode !== "keyword") await sleep(3500);
  }
  const same = pair[0].status === 200 && pair[1].status === 200 && pair[0].hash === pair[1].hash;
  rows.push({ ...c, same, old: pair[0], new: pair[1] });
  console.log(same ? "SAME" : "DIFF", c.mode.padEnd(8), c.type.padEnd(5), c.q.padEnd(10), pair.map((p) => `${p.status}/${p.count}/${p.hash}/${p.ms}ms`).join("  "));
}
mkdirSync(".vercel", { recursive: true });
writeFileSync(`.vercel/compare-search-${ids.join("-")}.json`, JSON.stringify(rows, null, 1));
const allSame = rows.every((r) => r.same);
console.log(JSON.stringify({ old: ids[0], new: ids[1], cases: rows.length, identical: rows.filter((r) => r.same).length, allSame }));
if (!allSame) process.exitCode = 1;
