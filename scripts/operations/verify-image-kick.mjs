// Function Storage C-1: hosted check of the photo route's internal drain request.
// Preview only. Runs the real kickImageJobs() code against a protected Preview
// deployment URL (what VERCEL_URL holds at runtime) and proves:
//   1. deployment protection blocks the drain URL without the bypass header;
//   2. the app rejects a missing or wrong cron secret (401);
//   3. concurrent kicks finish one queued job with exactly one claim (no duplicate inference);
//   4. without any kick the job stays queued and the request-time recovery finishes it (no loss);
//   5. the queue has no backlog afterwards.
// Fixtures: one throwaway user + two lost posts + two Storage objects, recorded in
// .vercel/image-kick-<marker>.json from creation and removed in finally.
// Usage (PowerShell or bash):
//   node --env-file=.env.preview.local scripts/operations/verify-image-kick.mjs --deployment=https://<preview-deployment>.vercel.app
// Secrets (Preview CRON_SECRET, project bypass key) are never printed.
import "../db/install-guard.mjs";
import { assertDatabaseEnvironment, PREVIEW_DB_PROJECT } from "../../src/lib/db/accessPolicy.mjs";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

if (assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview" || new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== `${PREVIEW_DB_PROJECT}.supabase.co`) throw new Error("Preview only");
const cronSecret = process.env.CRON_SECRET;
if (!cronSecret || cronSecret === "[SENSITIVE]") throw new Error("Preview CRON_SECRET missing");
const deploymentArg = process.argv.find((a) => a.startsWith("--deployment="))?.slice(13);
if (!deploymentArg) throw new Error("--deployment=https://<preview deployment> required");
const host = new URL(deploymentArg).hostname;
if (!/^[a-z0-9-]+\.vercel\.app$/.test(host)) throw new Error("Vercel deployment host required");

function vercelApi(path) {
  const out = execFileSync("npx", ["--no-install", "vercel", "api", path, "--scope", "oyueo"], { encoding: "utf8", shell: true, windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  return JSON.parse(out.slice(out.indexOf("{")));
}
const deployment = vercelApi(`/v13/deployments/${host}`);
if (deployment.target === "production" || deployment.readyState !== "READY") throw new Error("Ready Preview deployment required");
const bypass = Object.keys(vercelApi("/v9/projects/prj_zMYrrsw80l829lSjs2n2Ur6YV5eP").protectionBypass ?? {})[0];
if (!bypass) throw new Error("Project has no automation bypass");
const vercelUrl = deployment.url; // exactly what VERCEL_URL is inside that deployment

const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } });
const { prisma } = await jiti.import("../../src/lib/db/prisma.ts");
const { kickImageJobs, imageJobDrainUrl } = await jiti.import("../../src/lib/ai/imageJobKick.ts");
const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const runtimeEnv = { CRON_SECRET: cronSecret, VERCEL_AUTOMATION_BYPASS_SECRET: bypass, VERCEL_URL: vercelUrl };
const drainUrl = imageJobDrainUrl("http://unused.invalid", runtimeEnv);

const marker = randomUUID();
const fixture = { marker, deployment: deployment.id, userId: null, posts: [], paths: [], cleaned: false };
mkdirSync(".vercel", { recursive: true });
const manifest = `.vercel/image-kick-${marker}.json`;
const record = () => writeFileSync(manifest, JSON.stringify(fixture));
record();
const results = [];
const check = (name, ok, detail = {}) => { results.push({ name, ok, ...detail }); console.log(ok ? "PASS" : "FAIL", name, JSON.stringify(detail)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jobOf = async (id) => (await prisma.$queryRaw`SELECT j.state,j.attempts,j.desired_hash=j.completed_hash AS current,vector_dims(p."imageEmbedding") AS dimensions,j.last_error FROM "ImageEmbeddingJob" j JOIN "LostPost" p ON p.id=j.post_id WHERE j.post_type='lost' AND j.post_id=${id}`)[0];
const backlog = async () => (await prisma.$queryRaw`SELECT state,count(*)::int AS n,min(updated_at) AS oldest FROM "ImageEmbeddingJob" WHERE state<>'completed' GROUP BY state ORDER BY state`);

async function makeImagePost(color) {
  const post = await prisma.lostPost.create({ data: { userId: fixture.userId, title: `C1 kick fixture ${marker}`, description: "Synthetic verification", category: "기타", location: "Synthetic verification", lostDate: new Date() } });
  fixture.posts.push(post.id); record();
  const path = `posts/lost/${post.id}/${marker}.jpg`;
  fixture.paths.push(path); record();
  const bytes = await sharp({ create: { width: 96, height: 96, channels: 3, background: color } }).jpeg().toBuffer();
  if ((await storage.storage.from("post-images").upload(path, bytes, { contentType: "image/jpeg" })).error) throw new Error("Fixture upload failed");
  await prisma.lostPost.update({ where: { id: post.id }, data: { imageUrl: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/post-images/${path}` } });
  return post.id;
}
async function waitDone(id, seconds) {
  let job;
  for (let i = 0; i < seconds; i++) { job = await jobOf(id); if (["completed", "failed"].includes(job?.state)) break; await sleep(1000); }
  return job;
}

try {
  // 1-2. Protection and app auth on the exact drain URL.
  const plain = await fetch(drainUrl, { redirect: "manual" });
  const plainBody = await plain.text();
  check("protection blocks drain URL without bypass", plain.status === 401 || (plain.status >= 300 && plain.status < 400), { status: plain.status, reachedApp: plainBody.includes('"Unauthorized"') });
  const noAuth = await fetch(drainUrl, { headers: { "x-vercel-protection-bypass": bypass }, redirect: "manual" });
  check("app rejects missing cron secret", noAuth.status === 401, { status: noAuth.status });
  const wrong = await fetch(drainUrl, { headers: { "x-vercel-protection-bypass": bypass, authorization: `Bearer ${randomBytes(cronSecret.length).toString("base64url").slice(0, cronSecret.length)}` }, redirect: "manual" });
  check("app rejects wrong cron secret", wrong.status === 401, { status: wrong.status });

  // 3. Real kick code, three at once, against one queued job.
  fixture.userId = (await prisma.user.create({ data: { email: `${marker}@image-kick.example.invalid`, name: "C1 kick fixture", nickname: "C1 kick fixture" } })).id; record();
  console.log("backlog before", JSON.stringify(await backlog()));
  const first = await makeImagePost({ r: 30, g: 120, b: 200 });
  const queued = await jobOf(first);
  check("trigger queued the job", queued?.state === "pending" && queued.attempts === 0, { state: queued?.state });
  const started = Date.now();
  const kicks = await Promise.all([1, 2, 3].map(() => kickImageJobs("http://unused.invalid", runtimeEnv)));
  const done = await waitDone(first, 90);
  check("kick drains job on the deployed model", kicks.every((k) => k === "sent") && done?.state === "completed" && done.current === true && done.dimensions === 768, { kicks, state: done?.state, ms: Date.now() - started });
  check("concurrent kicks claim once (no duplicate inference)", done?.attempts === 1, { attempts: done?.attempts });

  // 4. No kick: the job must stay queued, then the request-time recovery finishes it.
  const second = await makeImagePost({ r: 220, g: 180, b: 30 });
  await sleep(5000);
  const idle = await jobOf(second);
  check("without kick the job stays queued (not lost)", idle?.state === "pending", { state: idle?.state });
  const recoveryStart = Date.now();
  const search = await fetch(`https://${vercelUrl}/api/posts?type=lost&mode=keyword&limit=1`, { headers: { "x-vercel-protection-bypass": bypass } });
  await search.body?.cancel();
  const recovered = await waitDone(second, 120);
  check("request-time recovery completes the missed job", search.ok && recovered?.state === "completed" && recovered.current === true && recovered.dimensions === 768, { status: search.status, state: recovered?.state, attempts: recovered?.attempts, ms: Date.now() - recoveryStart });
} finally {
  try {
    if (fixture.userId) {
      if ((await prisma.user.findUnique({ where: { id: fixture.userId } }))?.email !== `${marker}@image-kick.example.invalid`) throw new Error("Cleanup owner mismatch");
      for (const [i, path] of fixture.paths.entries()) {
        if (!path.startsWith(`posts/lost/${fixture.posts[i]}/`)) throw new Error("Cleanup path mismatch");
        if ((await storage.storage.from("post-images").remove([path])).error) throw new Error("Storage cleanup failed");
        const at = path.lastIndexOf("/"), left = await storage.storage.from("post-images").list(path.slice(0, at), { search: path.slice(at + 1) });
        if (left.error || left.data.some((o) => o.name === path.slice(at + 1))) throw new Error("Storage object remains");
      }
      await prisma.$transaction(async (tx) => {
        await tx.lostPost.deleteMany({ where: { id: { in: fixture.posts }, userId: fixture.userId } });
        await tx.matchCandidateCache.deleteMany({ where: { sourceType: "lost", sourcePostId: { in: fixture.posts } } });
        await tx.rateLimitCounter.deleteMany({ where: { OR: [{ key: { startsWith: `embeddingAutomatic:u:${fixture.userId}:` } }, ...fixture.posts.map((id) => ({ key: { startsWith: `embeddingLostPost:u:${id}:` } }))] } });
        await tx.user.delete({ where: { id: fixture.userId } });
      });
      const leftJobs = await prisma.$queryRaw`SELECT count(*)::int AS n FROM "ImageEmbeddingJob" WHERE post_type='lost' AND post_id = ANY(${fixture.posts})`;
      fixture.cleaned = true; record();
      console.log("cleanup", JSON.stringify({ userId: fixture.userId, posts: fixture.posts, jobsLeft: leftJobs[0].n }));
    }
    console.log("backlog after", JSON.stringify(await backlog()));
  } finally { await prisma.$disconnect(); }
}
const passed = results.length === 8 && results.every((r) => r.ok);
console.log(JSON.stringify({ suite: "image-kick-hosted", deployment: deployment.id, passed, checks: results.length }));
if (!passed) process.exitCode = 1;
