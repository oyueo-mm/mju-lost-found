// Batch 2 (append-only): adds data2.ts's posts to the Preview DB without
// touching existing rows (skips any exact-title duplicate), using the real
// embedding / signed-upload / setPostImage / image-embedding code. Then
// clears the derived recommendation cache, re-evaluates every pair now in
// Preview with the real recommendation / semantic search / image search
// functions, and writes docs/ai-eval-seed/ground-truth.json.
// Run with: npx tsx --env-file=.env.preview.local scripts/ai-eval-seed/add-batch2.ts <imageDir>
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db/prisma";
import { embedPostBestEffort, embedPostImageBestEffort } from "@/lib/ai/postEmbedding";
import { createSignedUploadUrl } from "@/lib/images/supabaseAdmin";
import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";
import { buildImagePathname } from "@/lib/images/pathname";
import { setPostImage } from "@/lib/images/service";
import { POST_IMAGES_BUCKET } from "@/lib/images/config";
import { findPostRecommendations, invalidateRecommendationCache } from "@/lib/recommendation/service";
import { searchPosts, searchPostsByImage } from "@/lib/posts/aiService";
import { CURRENT_TERMS_VERSION } from "@/lib/auth/terms";

import { DEMOS, NEGATIVES, PAIRS, POSTERS, type Board, type Pair, type PostSpec } from "./data";
import { allJobs, NEW_NEGATIVES, NEW_PAIRS, NO_MATCH, REUSED_NEG_IDS, REUSED_PAIR_IDS } from "./data2";
import { EXTRA_QUERIES, EXTRA_SCENARIOS } from "./extra-scenarios";

const PREVIEW_REF = "swqvlihgupranzfzjevb";
const PRODUCTION_REF = "tmifqtyxojtuoejxjrng";

// Posts already in Preview before this batch (seed-demo.ts + add-extra.ts).
const BATCH0_PAIRS = ["P08", "P01", "P17", "P11"];
const BATCH0_NEGS = ["N09", "N12", "N01", "N03", "N22", "N23", "N14", "N16"];
const BATCH1_PAIRS = EXTRA_SCENARIOS.map((s) => s.pairId);
const BATCH1_NEGS = EXTRA_SCENARIOS.flatMap((s) => s.negIds);

function assertPreviewOnly() {
  const db = process.env.DATABASE_URL ?? "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let keyRef = "";
  try {
    keyRef = JSON.parse(Buffer.from((process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").split(".")[1] ?? "", "base64").toString("utf8")).ref ?? "";
  } catch {
    keyRef = "";
  }
  if (!(db.includes(PREVIEW_REF) && url.includes(PREVIEW_REF) && keyRef === PREVIEW_REF) || [db, url, keyRef].some((v) => v.includes(PRODUCTION_REF))) {
    throw new Error("Refusing to run: not all credentials point at the Preview project.");
  }
}

async function ensureUsers(now: number) {
  const users = [];
  for (let i = 0; i < POSTERS.length; i++) {
    const email = `lf.seed.${String(i + 1).padStart(2, "0")}@mju.ac.kr`;
    const existing = await prisma.user.findUnique({ where: { email } });
    users.push(
      existing ??
        (await prisma.user.create({
          data: {
            email,
            name: POSTERS[i].nickname,
            nickname: POSTERS[i].nickname,
            privacyConsentAt: new Date(now),
            termsAcceptedAt: new Date(now),
            termsVersion: CURRENT_TERMS_VERSION,
            createdAt: new Date(now - 32 * 24 * 3600_000),
          },
        })),
    );
  }
  return users;
}

async function findByTitle(board: Board, title: string) {
  return board === "lost" ? prisma.lostPost.findFirst({ where: { title } }) : prisma.foundPost.findFirst({ where: { title } });
}

async function createPost(board: Board, key: string, spec: PostSpec, userId: number, now: number, viewCount: number, imageDir: string) {
  const existing = await findByTitle(board, spec.title);
  if (existing) return false;
  const createdAt = new Date(now - spec.createdAgoH * 3600_000);
  const eventAt = spec.eventGapH === null ? null : new Date(createdAt.getTime() - spec.eventGapH * 3600_000);
  const base = { userId, title: spec.title, description: spec.description, category: spec.category, campus: spec.campus, location: spec.location, createdAt, viewCount };
  const row =
    board === "lost"
      ? await prisma.lostPost.create({ data: { ...base, lostAt: eventAt } })
      : await prisma.foundPost.create({ data: { ...base, foundAt: eventAt } });
  await embedPostBestEffort(board, row.id, row);
  const file = path.join(imageDir, `${key}.jpg`);
  if (spec.image && existsSync(file)) {
    const { path: uploadPath, token } = await createSignedUploadUrl(buildImagePathname(board, row.id, "image/jpeg"));
    const { error } = await getSupabaseAdminClient().storage.from(POST_IMAGES_BUCKET).uploadToSignedUrl(uploadPath, token, await readFile(file), { contentType: "image/jpeg" });
    if (error) throw new Error(`upload failed: ${error.message}`);
    const result = await setPostImage(board, row.id, userId, { path: uploadPath });
    if (result.kind !== "ok") throw new Error(`setPostImage failed: ${result.kind}`);
    await embedPostImageBestEffort(board, row.id, result.data.imageUrl);
    await invalidateRecommendationCache(board, row.id);
  }
  console.log(`  + ${board} #${row.id} ${key} "${row.title}"${spec.image ? " [image]" : ""}`);
  return true;
}

type Hit = { id: number; title: string; score?: number };
const rank = (items: Hit[], id: number) => {
  const i = items.findIndex((r) => r.id === id);
  return i < 0 ? null : i + 1;
};
const top = (items: Hit[], n = 3) => items.slice(0, n).map((r) => ({ id: r.id, title: r.title, score: Number((r.score ?? 0).toFixed(3)) }));

async function main() {
  assertPreviewOnly();
  const imageDir = process.argv[2];
  if (!imageDir) throw new Error("usage: add-batch2.ts <imageDir>");
  const now = Date.now();
  const users = await ensureUsers(now);

  const jobs = allJobs().sort((a, b) => b.spec.createdAgoH - a.spec.createdAgoH);
  let added = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (await createPost(job.board, job.key, job.spec, users[(i * 7 + 2) % users.length].id, now, 3 + ((i * 31) % 50), imageDir)) added++;
  }
  console.log(`Added ${added} posts.`);
  await prisma.matchCandidateCache.deleteMany({});

  // ---------- evaluation ----------
  const queryDir = path.join(process.cwd(), "docs", "ai-eval-seed", "query-images");
  const demoQuery: Record<string, { query: string; image?: string }> = {};
  for (const d of DEMOS) demoQuery[d.pairId] = { query: d.searchQuery, image: `${d.demoId}.jpg` };
  for (const [pairId, q] of Object.entries(EXTRA_QUERIES)) demoQuery[pairId] = { query: q, image: demoQuery[pairId]?.image };
  for (const id of ["Q01", "Q02", "Q03", "Q06", "P26"]) demoQuery[id] = { query: demoQuery[id]?.query ?? "", image: `${id}.jpg` };

  const pairDefs: { pair: Pair; batch: string }[] = [
    ...BATCH0_PAIRS.map((id) => ({ pair: PAIRS.find((p) => p.pairId === id)!, batch: "batch0-demo" })),
    ...BATCH1_PAIRS.map((id) => ({ pair: PAIRS.find((p) => p.pairId === id)!, batch: "batch1-extra" })),
    ...REUSED_PAIR_IDS.map((id) => ({ pair: PAIRS.find((p) => p.pairId === id)!, batch: "batch2" })),
    ...NEW_PAIRS.map((pair) => ({ pair, batch: "batch2" })),
  ];
  const negDefs = [
    ...[...BATCH0_NEGS, ...BATCH1_NEGS, ...REUSED_NEG_IDS].map((id) => {
      const n = NEGATIVES.find((x) => x.negId === id)!;
      return { ...n, batch: BATCH0_NEGS.includes(id) ? "batch0-demo" : BATCH1_NEGS.includes(id) ? "batch1-extra" : "batch2" };
    }),
    ...NEW_NEGATIVES.map((n) => ({ ...n, batch: "batch2" })),
  ];

  const pairsOut = [];
  for (const { pair, batch } of pairDefs) {
    const lost = await findByTitle("lost", pair.lost.title);
    const found = await findByTitle("found", pair.found.title);
    if (!lost || !found) throw new Error(`missing post for ${pair.pairId}`);
    const recs = await findPostRecommendations("lost", lost.id);
    const byTitle = await searchPosts({ type: "found", mode: "semantic", q: pair.lost.title, page: 1, limit: 10 });
    const custom = demoQuery[pair.pairId]?.query;
    const byCustom = custom ? await searchPosts({ type: "found", mode: "semantic", q: custom, page: 1, limit: 10 }) : null;
    const imgFile = demoQuery[pair.pairId]?.image ? path.join(queryDir, demoQuery[pair.pairId].image!) : null;
    let imageRank: number | null | "n/a" = "n/a";
    let imageTop: ReturnType<typeof top> = [];
    if (imgFile && existsSync(imgFile) && found.imageUrl) {
      const res = await searchPostsByImage("found", new Blob([new Uint8Array(await readFile(imgFile))], { type: "image/jpeg" }), { page: 1, limit: 10 });
      imageRank = rank(res.items, found.id);
      imageTop = top(res.items);
    }
    const confusers = negDefs.filter((n) => n.confusableWith.includes(pair.pairId));
    pairsOut.push({
      pairId: pair.pairId,
      batch,
      itemType: pair.itemType,
      difficulty: pair.difficulty,
      locationRelation: pair.locationRelation,
      timeRelation: pair.timeRelation,
      keyClues: pair.keyClues,
      lost: { id: lost.id, title: lost.title, hasImage: !!lost.imageUrl },
      found: { id: found.id, title: found.title, hasImage: !!found.imageUrl },
      hardNegatives: confusers.map((n) => n.negId),
      results: {
        recommendationRank: rank(recs, found.id),
        recommendationTop3: top(recs),
        semanticByLostTitle: { query: pair.lost.title, rank: rank(byTitle.items, found.id), top3: top(byTitle.items) },
        semanticByDemoQuery: byCustom ? { query: custom, rank: rank(byCustom.items, found.id), top3: top(byCustom.items) } : null,
        imageSearch: imageRank === "n/a" ? null : { queryImage: demoQuery[pair.pairId].image, rank: imageRank, top3: imageTop },
      },
    });
  }

  const negOut = [];
  for (const n of negDefs) {
    const row = await findByTitle(n.board, n.post.title);
    negOut.push({ negId: n.negId, batch: n.batch, board: n.board, id: row?.id, title: n.post.title, itemType: n.itemType, confusableWith: n.confusableWith, whyNotMatch: n.whyNotMatch, hasImage: !!row?.imageUrl });
  }

  const noMatchOut = [];
  for (const m of NO_MATCH) {
    const row = (await findByTitle(m.board, m.post.title))!;
    const recs = await findPostRecommendations(m.board, row.id);
    const other: Board = m.board === "lost" ? "found" : "lost";
    const sem = await searchPosts({ type: other, mode: "semantic", q: m.post.title, page: 1, limit: 10 });
    noMatchOut.push({
      noMatchId: m.noMatchId, board: m.board, id: row.id, title: row.title, nearestTheme: m.nearestTheme, hasImage: false,
      results: { recommendationTop3: top(recs), semanticByTitle: { query: m.post.title, resultCount: sem.items.length, top3: top(sem.items) } },
    });
  }

  const [lostN, foundN, lostImg, foundImg] = await Promise.all([
    prisma.lostPost.count(), prisma.foundPost.count(),
    prisma.lostPost.count({ where: { imageUrl: { not: null } } }), prisma.foundPost.count({ where: { imageUrl: { not: null } } }),
  ]);
  const summary = { lostPosts: lostN, foundPosts: foundN, total: lostN + foundN, withImage: lostImg + foundImg, pairs: pairsOut.length, hardNegatives: negOut.length, noMatch: noMatchOut.length };

  const outFile = path.join(process.cwd(), "docs", "ai-eval-seed", "ground-truth.json");
  await writeFile(
    outFile,
    JSON.stringify({ environment: `Preview (${PREVIEW_REF})`, generatedAt: new Date(now).toISOString(), note: "서비스 DB 스키마와 무관한 평가용 metadata. 이미지는 코드로 그린 합성 이미지이며 실사진이 아님.", summary, pairs: pairsOut, hardNegatives: negOut, noMatch: noMatchOut }, null, 2),
  );

  console.log("\nSUMMARY", JSON.stringify(summary));
  console.log("\npairId batch diff | rec | sem(title) | sem(query) | image");
  for (const p of pairsOut) {
    const r = p.results;
    console.log(`${p.pairId} ${p.batch} ${p.difficulty} ${p.itemType} | ${r.recommendationRank ?? "-"} | ${r.semanticByLostTitle.rank ?? "-"} | ${r.semanticByDemoQuery?.rank ?? ""} | ${r.imageSearch ? r.imageSearch.rank ?? "-" : ""}   top1(rec)=${r.recommendationTop3[0]?.title ?? ""} top1(sem)=${r.semanticByLostTitle.top3[0]?.title ?? "없음"}`);
  }
  console.log("\nNO-MATCH");
  for (const m of noMatchOut) {
    console.log(`${m.noMatchId} ${m.board} "${m.title}" rec-top1=${m.results.recommendationTop3[0]?.title ?? "-"}(${m.results.recommendationTop3[0]?.score ?? ""}) sem-count=${m.results.semanticByTitle.resultCount} sem-top1=${m.results.semanticByTitle.top3[0]?.title ?? "-"}(${m.results.semanticByTitle.top3[0]?.score ?? ""})`);
  }
  console.log(`\nWrote ${outFile}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
