// Function Storage C-2: hosted check of queued text re-embedding on a protected
// Preview deployment, with the deployed real model. Proves:
//   1. a text change queues one job (DB trigger) and concurrent drain requests
//      finish it with one claim, 768 dimensions;
//   2. the queued vector equals what the previous (inline) deployment's model
//      produces: an exact-text semantic search ranks the post first with the
//      same score on the new and the --baseline deployment;
//   3. without a drain request the job waits and the request-time recovery
//      finishes it (no loss); 4. no backlog remains.
// Fixtures: one throwaway user + one lost post (no photo), recorded in
// .vercel/text-kick-<marker>.json and removed in finally.
//   node --env-file=.env.preview.local scripts/operations/verify-text-kick.mjs --deployment=https://<new>.vercel.app --baseline=https://<previous>.vercel.app
import "../db/install-guard.mjs";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

if (assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview") throw new Error("Preview only");
const cronSecret = process.env.CRON_SECRET;
if (!cronSecret || cronSecret === "[SENSITIVE]") throw new Error("Preview CRON_SECRET missing");
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
function vercelApi(path) {
  const out = execFileSync("npx", ["--no-install", "vercel", "api", path, "--scope", "oyueo"], { encoding: "utf8", shell: true, windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  return JSON.parse(out.slice(out.indexOf("{")));
}
const resolveDeployment = (url) => {
  const host = new URL(url).hostname;
  if (!/^[a-z0-9-]+\.vercel\.app$/.test(host)) throw new Error("Vercel deployment host required");
  const d = vercelApi(`/v13/deployments/${host}`);
  if (d.target === "production" || d.readyState !== "READY") throw new Error("Ready Preview deployment required");
  return d;
};
const deployment = resolveDeployment(arg("deployment") ?? "");
const baseline = resolveDeployment(arg("baseline") ?? "");
const bypass = Object.keys(vercelApi("/v9/projects/prj_zMYrrsw80l829lSjs2n2Ur6YV5eP").protectionBypass ?? {})[0];
if (!bypass) throw new Error("Project has no automation bypass");

const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } });
const { prisma } = await jiti.import("../../src/lib/db/prisma.ts");
const { kickEmbeddingJobs } = await jiti.import("../../src/lib/ai/imageJobKick.ts");
const { buildEmbeddingText } = await jiti.import("../../src/lib/ai/embedding.ts");
const runtimeEnv = { CRON_SECRET: cronSecret, VERCEL_AUTOMATION_BYPASS_SECRET: bypass, VERCEL_URL: deployment.url };

const marker = randomUUID();
const fixture = { marker, deployment: deployment.id, userId: null, postId: null, cleaned: false };
mkdirSync(".vercel", { recursive: true });
const manifest = `.vercel/text-kick-${marker}.json`;
const record = () => writeFileSync(manifest, JSON.stringify(fixture));
record();
const results = [];
const check = (name, ok, detail = {}) => { results.push({ name, ok: !!ok }); console.log(ok ? "PASS" : "FAIL", name, JSON.stringify(detail)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jobOf = async () => (await prisma.$queryRaw`SELECT j.state,j.attempts,j.generation,j.completed_generation,vector_dims(p.embedding) AS dims,p.embedding IS NOT NULL AS has_vector FROM "LostPost" p LEFT JOIN "TextEmbeddingJob" j ON j.post_type='lost' AND j.post_id=p.id WHERE p.id=${fixture.postId}`)[0];
const backlog = async () => prisma.$queryRaw`SELECT state,count(*)::int AS n FROM "TextEmbeddingJob" WHERE state<>'completed' GROUP BY state`;
async function waitDone(seconds) { let j; for (let i = 0; i < seconds; i++) { j = await jobOf(); if (["completed", "failed"].includes(j?.state)) break; await sleep(1000); } return j; }
async function semanticTop(d, q) {
  const r = await fetch(`https://${d.url}/api/posts?type=lost&mode=semantic&limit=5&q=${encodeURIComponent(q)}`, { headers: { "x-vercel-protection-bypass": bypass } });
  const j = await r.json().catch(() => null);
  const items = j?.data ?? [];
  return { status: r.status, rank: items.findIndex((i) => i.id === fixture.postId) + 1, score: items.find((i) => i.id === fixture.postId)?.score ?? null };
}

try {
  fixture.userId = (await prisma.user.create({ data: { email: `${marker}@text-kick.example.invalid`, name: "C2 text fixture", nickname: "C2 text fixture" } })).id; record();
  // A distinctive text so an exact-text semantic query isolates the post.
  fixture.postId = (await prisma.lostPost.create({ data: { userId: fixture.userId, title: `C2 검증 보라색 우주 고양이 열쇠고리 ${marker.slice(0, 8)}`, description: "합성 검증 데이터", category: "기타", location: "가상 검증 장소", lostDate: new Date() } })).id; record();
  console.log("backlog before", JSON.stringify(await backlog()));

  // 1. Edit -> trigger -> three concurrent drains on the deployed model.
  await prisma.lostPost.update({ where: { id: fixture.postId }, data: { description: `합성 검증 데이터, 수정 ${marker.slice(0, 8)}` } });
  const queued = await jobOf();
  check("text edit queued one generation", queued?.state === "pending" && queued.generation === 1, queued);
  const started = Date.now();
  const kicks = await Promise.all([1, 2, 3].map(() => kickEmbeddingJobs("http://unused.invalid", runtimeEnv)));
  const done = await waitDone(90);
  check("drain completes it with the deployed model", kicks.every((k) => k === "sent") && done?.state === "completed" && done.dims === 768 && done.completed_generation === 1, { kicks, ms: Date.now() - started });
  check("concurrent drains claim once (no duplicate inference)", done?.attempts === 1, { attempts: done?.attempts });

  // 2. Vector equality with the inline model: exact-text semantic search.
  const post = await prisma.lostPost.findUnique({ where: { id: fixture.postId } });
  const text = buildEmbeddingText(post);
  const fresh = await semanticTop(deployment, text);
  await sleep(4000);
  const old = await semanticTop(baseline, text);
  check("exact-text semantic search ranks the post first on the new deployment", fresh.status === 200 && fresh.rank === 1, fresh);
  check("same rank and score on the previous (inline) deployment", old.status === 200 && old.rank === 1 && old.score === fresh.score, old);

  // 3. No drain request: the job waits, then request-time recovery finishes it.
  // Recovery runs at most once per 15 s per warm instance (textJob.ts), and the
  // searches above just used that window, so the recovering request comes 16 s
  // after the last /api/posts request.
  const lastApiRequest = Date.now();
  await prisma.lostPost.update({ where: { id: fixture.postId }, data: { location: `가상 검증 장소 ${marker.slice(0, 4)}` } });
  await sleep(5000);
  const idle = await jobOf();
  check("without a drain request the job stays queued (not lost)", idle?.state === "pending" && idle.generation === 2, idle);
  await sleep(Math.max(0, lastApiRequest + 16000 - Date.now()));
  const recoveryStart = Date.now();
  const search = await fetch(`https://${deployment.url}/api/posts?type=lost&mode=keyword&limit=1`, { headers: { "x-vercel-protection-bypass": bypass } });
  await search.body?.cancel();
  const recovered = await waitDone(120);
  check("request-time recovery completes it", search.ok && recovered?.state === "completed" && recovered.completed_generation === 2 && recovered.dims === 768, { status: search.status, ms: Date.now() - recoveryStart });
} finally {
  try {
    if (fixture.userId) {
      if ((await prisma.user.findUnique({ where: { id: fixture.userId } }))?.email !== `${marker}@text-kick.example.invalid`) throw new Error("Cleanup owner mismatch");
      await prisma.$transaction(async (tx) => {
        if (fixture.postId) { await tx.matchCandidateCache.deleteMany({ where: { sourceType: "lost", sourcePostId: fixture.postId } }); await tx.lostPost.deleteMany({ where: { id: fixture.postId, userId: fixture.userId } }); }
        await tx.rateLimitCounter.deleteMany({ where: { key: { startsWith: `embeddingAutomatic:u:${fixture.userId}:` } } });
        await tx.user.delete({ where: { id: fixture.userId } });
      });
      const left = fixture.postId ? (await prisma.$queryRaw`SELECT count(*)::int AS n FROM "TextEmbeddingJob" WHERE post_type='lost' AND post_id=${fixture.postId}`)[0].n : 0;
      fixture.cleaned = true; record();
      console.log("cleanup", JSON.stringify({ userId: fixture.userId, postId: fixture.postId, jobsLeft: left }));
      if (left !== 0) process.exitCode = 1;
    }
    console.log("backlog after", JSON.stringify(await backlog()));
  } finally { await prisma.$disconnect(); }
}
const passed = results.length === 7 && results.every((r) => r.ok);
console.log(JSON.stringify({ suite: "text-kick-hosted", deployment: deployment.id, baseline: baseline.id, passed, checks: results.length }));
if (!passed) process.exitCode = 1;
