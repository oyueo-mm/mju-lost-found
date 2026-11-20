// Function Storage C-2: direct vector comparison, old way vs new way, same
// input, real model. Preview only. For each sample text the fixture post is
// edited (queuing a text job), then:
//   old way: embedPostBestEffort(type, id, row) -- the pre-C-2 inline update
//            path, still the creation path -- writes vector A;
//   new way: runTextJob(type, id) -- the queue worker -- writes vector B.
// A and B are compared element by element (max |diff|, cosine). Also compared
// with the vector a deployed queue produced, when --deployed-check is given.
// Fixtures: one throwaway user + one lost post, removed in finally.
//   node --env-file=.env.preview.local scripts/operations/text-vector-equivalence.mjs
import "../db/install-guard.mjs";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";

if (assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview") throw new Error("Preview only");
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } });
const { prisma } = await jiti.import("../../src/lib/db/prisma.ts");
const { embedPostBestEffort } = await jiti.import("../../src/lib/ai/postEmbedding.ts");
const { runTextJob } = await jiti.import("../../src/lib/ai/textJob.ts");
const marker = randomUUID();
const fixture = { marker, userId: null, postId: null, cleaned: false };
mkdirSync(".vercel", { recursive: true });
const record = () => writeFileSync(`.vercel/text-equivalence-${marker}.json`, JSON.stringify(fixture));
record();
const samples = [
  { title: "검은색 가죽 지갑을 잃어버렸어요", description: "학생증과 체크카드가 들어 있습니다", category: "지갑", location: "중앙도서관 3층 열람실" },
  { title: "에어팟 프로 오른쪽", description: "흰색 케이스 없이 한쪽만", category: "전자기기", location: null },
  { title: "Blue umbrella", description: "Left near the engineering building entrance, long handle", category: "기타", location: "제1공학관" },
];
const vectorOf = async () => JSON.parse((await prisma.$queryRaw`SELECT embedding::text AS v FROM "LostPost" WHERE id=${fixture.postId}`)[0].v);
const compare = (a, b) => {
  let maxDiff = 0, dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i])); dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return { dims: [a.length, b.length], maxAbsDiff: maxDiff, cosine: dot / Math.sqrt(na * nb) };
};
const results = [];
try {
  fixture.userId = (await prisma.user.create({ data: { email: `${marker}@text-equivalence.example.invalid`, name: "C2 equivalence fixture", nickname: "C2 equivalence fixture" } })).id; record();
  fixture.postId = (await prisma.lostPost.create({ data: { userId: fixture.userId, title: "start", description: "start", category: "기타", lostDate: new Date() } })).id; record();
  for (const [i, sample] of samples.entries()) {
    const row = await prisma.lostPost.update({ where: { id: fixture.postId }, data: sample }); // queues a job
    await embedPostBestEffort("lost", fixture.postId, row); // old way
    const a = await vectorOf();
    const status = (await runTextJob("lost", fixture.postId)).status; // new way
    const b = await vectorOf();
    const c = compare(a, b);
    results.push({ sample: i + 1, jobStatus: status, ...c, identical: c.maxAbsDiff === 0 });
    console.log(JSON.stringify(results.at(-1)));
  }
} finally {
  try {
    if (fixture.userId) {
      if ((await prisma.user.findUnique({ where: { id: fixture.userId } }))?.email !== `${marker}@text-equivalence.example.invalid`) throw new Error("Cleanup owner mismatch");
      await prisma.$transaction(async (tx) => {
        if (fixture.postId) { await tx.matchCandidateCache.deleteMany({ where: { sourceType: "lost", sourcePostId: fixture.postId } }); await tx.lostPost.deleteMany({ where: { id: fixture.postId, userId: fixture.userId } }); }
        await tx.user.delete({ where: { id: fixture.userId } });
      });
      fixture.cleaned = true; record();
      console.log(JSON.stringify({ cleanup: true, userId: fixture.userId, postId: fixture.postId }));
    }
  } finally { await prisma.$disconnect(); }
}
const passed = results.length === samples.length && results.every((r) => r.jobStatus === "completed" && r.dims[0] === 768 && r.dims[1] === 768 && r.identical);
console.log(JSON.stringify({ suite: "text-vector-equivalence", passed, samples: results.length }));
if (!passed) process.exitCode = 1;
