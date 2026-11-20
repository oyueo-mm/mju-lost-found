// Function Storage C-2: Preview-only integration of the text embedding queue.
// Real Preview database, real trigger/claim/fence/commit SQL, independent
// worker processes; the model is a deterministic local test double (the
// deployed model is compared separately). Fixtures: one throwaway user + one
// lost post, recorded in .vercel/text-jobs-<marker>.json and removed in finally.
//   node --env-file=.env.preview.local scripts/operations/verify-text-jobs.mjs
import "../db/install-guard.mjs";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

if (assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview") throw new Error("Preview only");
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } });
const { prisma } = await jiti.import("../../src/lib/db/prisma.ts");
const FIXTURE_DOMAIN = "@text-jobs.example.invalid";
// Deterministic stand-in for the real model: one-hot at a text-derived index.
const indexOf = (text) => createHash("sha256").update(text).digest().readUInt16BE(0) % 768;
const fakeVector = (text) => Array.from({ length: 768 }, (_, i) => (i === indexOf(text) ? 1 : 0));

const [mode, rawId, log, delay = "0", fail = "0"] = process.argv.slice(2);
if (mode === "worker") {
  const { getEmbeddingProvider } = await jiti.import("../../src/lib/ai/embedding.ts");
  getEmbeddingProvider().embed = async (text) => {
    appendFileSync(log, JSON.stringify({ started: true, text }) + "\n");
    await new Promise((r) => setTimeout(r, Number(delay)));
    if (fail === "1") throw new Error("SyntheticInferenceFailure");
    return fakeVector(text);
  };
  const { runTextJob } = await jiti.import("../../src/lib/ai/textJob.ts");
  try {
    const post = await prisma.lostPost.findUnique({ where: { id: Number(rawId) }, include: { user: true } });
    if (!post?.user.email.endsWith(FIXTURE_DOMAIN)) throw new Error("Not a fixture");
    console.log(JSON.stringify(await runTextJob("lost", post.id)));
  } finally { await prisma.$disconnect(); }
  process.exit(0);
}

const marker = randomUUID();
let user, postId;
mkdirSync(".vercel", { recursive: true });
const logFile = `.vercel/text-jobs-${marker}.jsonl`; writeFileSync(logFile, "");
const manifest = `.vercel/text-jobs-${marker}.json`;
const record = (cleaned = false) => writeFileSync(manifest, JSON.stringify({ marker, userId: user?.id ?? null, postId: postId ?? null, cleaned }, null, 2));
record();
const inferences = () => readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).length;
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log(JSON.stringify({ check: name, passed: !!ok, ...(detail ? { detail } : {}) })); if (!ok) throw new Error(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function worker(delayMs = 0, failFlag = 0, onChild = () => {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [fileURLToPath(import.meta.url), "worker", String(postId), logFile, String(delayMs), String(failFlag)], { env: process.env, windowsHide: true });
    onChild(c); let out = "";
    c.stdout.on("data", (b) => (out += b)); c.stderr.on("data", () => {});
    c.on("error", () => reject(new Error("Worker could not start")));
    c.on("close", (code) => { if (code !== 0) return reject(new Error("Worker failed")); try { resolve(JSON.parse(out.trim().split("\n").at(-1))); } catch { reject(new Error("Worker output invalid")); } });
  });
}
const state = async () => (await prisma.$queryRaw`SELECT p.title,p.description,p.category,p.location,p.embedding::text AS vector,j.generation,j.completed_generation,j.state,j.attempts,j.lease_token,j.last_error,(j.next_run_at > (now() AT TIME ZONE 'UTC')) AS backing_off FROM "LostPost" p LEFT JOIN "TextEmbeddingJob" j ON j.post_type='lost' AND j.post_id=p.id WHERE p.id=${postId}`)[0];
const vectorFor = (fields) => `[${fakeVector([fields.title, fields.description, fields.category, fields.location].filter((v) => v && v.trim()).join(" ")).join(",")}]`;
const edit = (data) => prisma.lostPost.update({ where: { id: postId }, data });
const cacheRow = () => prisma.matchCandidateCache.upsert({ where: { sourceType_sourcePostId: { sourceType: "lost", sourcePostId: postId } }, create: { sourceType: "lost", sourcePostId: postId, candidates: [] }, update: { candidates: [] } });
const cacheExists = async () => !!(await prisma.matchCandidateCache.findUnique({ where: { sourceType_sourcePostId: { sourceType: "lost", sourcePostId: postId } } }));

try {
  user = await prisma.user.create({ data: { email: `${marker}${FIXTURE_DOMAIN}`, name: "Text job fixture", nickname: "Text job fixture" } }); record();
  postId = (await prisma.lostPost.create({ data: { userId: user.id, title: `Text job ${marker}`, description: "Synthetic fixture", category: "기타", location: "Synthetic fixture", lostDate: new Date() } })).id; record();
  // Creation still embeds inline (/api/posts); stand in with a known vector.
  const original = vectorFor(await state());
  await prisma.$executeRaw`UPDATE "LostPost" SET embedding=${original}::vector WHERE id=${postId}`;
  check("creation and the inline vector queue nothing", !(await state()).state);

  // 1. Basic: edit -> one queued generation -> worker writes the new text's vector, invalidates cache.
  await edit({ title: `Edited ${marker}` }); await cacheRow();
  let s = await state();
  check("a text edit queues generation 1 and keeps the old vector until done", s.state === "pending" && s.generation === 1 && s.vector === original);
  check("worker completes", (await worker()).status === "completed");
  s = await state();
  check("new vector matches the stored text exactly", s.vector === vectorFor(s) && s.vector !== original && s.state === "completed" && s.completed_generation === 1 && s.attempts === 1);
  check("recommendation cache invalidated with the new vector", !(await cacheExists()));

  // 2. Status-only and same-value edits queue nothing.
  await edit({ status: "FOUND" }); await edit({ title: s.title });
  check("status/same-value edits do not re-queue", (await state()).generation === 1 && (await state()).state === "completed");
  await edit({ status: "SEARCHING" });

  // 3. Concurrent workers: one inference, one claim.
  await edit({ description: `Concurrent ${marker}` });
  let before = inferences();
  const concurrent = await Promise.all([1, 2, 3, 4].map(() => worker(800)));
  s = await state();
  check("four concurrent workers -> one inference", inferences() - before === 1 && concurrent.filter((r) => r.status === "completed").length === 1 && concurrent.filter((r) => r.status === "in_progress").length === 3, concurrent.map((r) => r.status));
  check("and the job is claimed once", s.state === "completed" && s.attempts === 1 && s.vector === vectorFor(s));

  // 4. Stale result: an edit during inference wins; the late result is never written.
  await edit({ title: `Before ${marker}` });
  const prior = (await state()).vector;
  const slow = worker(3000);
  await sleep(1500);
  await edit({ title: `Latest ${marker}` });
  check("late result for the older text is dropped", (await slow).status === "stale");
  s = await state();
  check("old vector kept, newer generation pending, lease released", s.vector === prior && s.state === "pending" && s.generation === 4 && s.lease_token === null);
  check("next run embeds the latest text", (await worker()).status === "completed" && (await state()).vector === vectorFor(await state()) && (await state()).title === `Latest ${marker}`);

  // 5. Failure, backoff and retry keep the previous vector.
  await edit({ location: `Retry ${marker}` });
  const kept = (await state()).vector;
  check("inference failure -> failed", (await worker(0, 1)).status === "failed");
  s = await state();
  check("failed job keeps the old vector and backs off", s.state === "failed" && s.vector === kept && s.attempts === 1 && s.backing_off === true && s.last_error === "Error");
  before = inferences();
  check("no retry before the backoff ends", (await worker()).status === "in_progress" && inferences() === before);
  await sleep(10500);
  check("retry after the backoff completes", (await worker()).status === "completed" && (await state()).attempts === 2 && (await state()).vector === vectorFor(await state()));

  // 6. A crashed worker's lease expires and the job is taken over.
  await edit({ category: "지갑" });
  let child;
  const started = inferences();
  const crashed = worker(60000, 0, (c) => (child = c)).catch(() => "killed");
  for (let i = 0; i < 300 && inferences() === started; i++) await sleep(100); // wait until it is inferring
  await sleep(300); child.kill(); await crashed;
  s = await state();
  check("crashed worker leaves a running lease", s.state === "running" && s.lease_token?.startsWith("text-v1:"));
  check("an unexpired lease is not taken over", (await worker()).status === "in_progress");
  await prisma.$executeRaw`UPDATE "TextEmbeddingJob" SET lease_until=(now() AT TIME ZONE 'UTC')-interval '1 second' WHERE post_type='lost' AND post_id=${postId}`; // time passes
  check("after expiry the job is recovered", (await worker()).status === "completed" && (await state()).vector === vectorFor(await state()));

  // 7. Five failures stop automatic retries; a new edit re-arms.
  await edit({ title: `Exhaust ${marker}` });
  for (let i = 0; i < 5; i++) { await prisma.$executeRaw`UPDATE "TextEmbeddingJob" SET next_run_at=(now() AT TIME ZONE 'UTC') WHERE post_type='lost' AND post_id=${postId}`; await worker(0, 1); }
  s = await state();
  check("after five failures automatic retries stop", s.state === "failed" && s.attempts === 5 && (await worker()).status === "in_progress");
  await edit({ title: `Rearmed ${marker}` });
  check("a new edit re-arms it", (await worker()).status === "completed" && (await state()).attempts === 1);

  // 8. Compatibility: an older deployment's inline write still lands (no fence on text).
  const legacy = `[${fakeVector("legacy").join(",")}]`;
  await prisma.$executeRaw`UPDATE "LostPost" SET embedding=${legacy}::vector WHERE id=${postId}`;
  check("legacy inline write is accepted", (await state()).vector === legacy);

  // 9. Delete removes the job.
  check("job exists before delete", (await prisma.$queryRaw`SELECT count(*)::int AS n FROM "TextEmbeddingJob" WHERE post_type='lost' AND post_id=${postId}`)[0].n === 1);
} finally {
  try {
    if (user) {
      if ((await prisma.user.findUnique({ where: { id: user.id } }))?.email !== `${marker}${FIXTURE_DOMAIN}`) throw new Error("Cleanup owner mismatch");
      await prisma.$transaction(async (tx) => {
        if (postId) { await tx.matchCandidateCache.deleteMany({ where: { sourceType: "lost", sourcePostId: postId } }); await tx.lostPost.deleteMany({ where: { id: postId, userId: user.id } }); }
        await tx.user.delete({ where: { id: user.id } });
      });
      const left = postId ? (await prisma.$queryRaw`SELECT count(*)::int AS n FROM "TextEmbeddingJob" WHERE post_type='lost' AND post_id=${postId}`)[0].n : 0;
      console.log(JSON.stringify({ cleanup: true, userId: user.id, postId, jobsLeft: left }));
      if (left !== 0) process.exitCode = 1;
      record(true);
    }
  } finally { await prisma.$disconnect(); }
}
const passed = results.length > 0 && results.every((r) => r.ok);
console.log(JSON.stringify({ suite: "text-jobs-preview", passed, checks: results.length, inferences: inferences() }));
if (!passed) process.exitCode = 1;
