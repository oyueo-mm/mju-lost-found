// Batch 3 (append-only): adds data3.ts's 150 posts to the Preview DB without
// touching any existing row (skips an exact-title duplicate), through the
// real embedding / signed-upload / setPostImage / image-embedding code, then
// clears the derived recommendation cache (a new opposite-board post never
// invalidates existing rows on its own) and extends
// docs/ai-eval-seed/ground-truth.json with the new metadata plus a flat
// per-post index of all posts. Existing entries' historical `results` are
// kept as-is.
// Run with: npx tsx --env-file=.env.preview.local scripts/ai-eval-seed/add-batch3.ts <imageDir>
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
import { invalidateRecommendationCache } from "@/lib/recommendation/service";
import { CURRENT_TERMS_VERSION } from "@/lib/auth/terms";

import { POSTERS, type Board, type PostSpec } from "./data";
import { allJobs3, NEGATIVES3, NO_MATCH3, PAIRS3, QUERY_IMAGES3 } from "./data3";

const PREVIEW_REF = "swqvlihgupranzfzjevb";
const PRODUCTION_REF = "tmifqtyxojtuoejxjrng";

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
  if (await findByTitle(board, spec.title)) return false;
  const createdAt = new Date(now - spec.createdAgoH * 3600_000);
  const eventAt = spec.eventGapH === null ? null : new Date(createdAt.getTime() - spec.eventGapH * 3600_000);
  const base = { userId, title: spec.title, description: spec.description, category: spec.category, campus: spec.campus, location: spec.location, createdAt, viewCount };
  const row =
    board === "lost"
      ? await prisma.lostPost.create({ data: { ...base, lostAt: eventAt } })
      : await prisma.foundPost.create({ data: { ...base, foundAt: eventAt } });
  await embedPostBestEffort(board, row.id, row);
  const file = path.join(imageDir, `${key}.jpg`);
  if (spec.image) {
    if (!existsSync(file)) throw new Error(`missing rendered image ${file}`);
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

type Ref = { board: Board; id: number; title: string; hasImage: boolean };

async function ref(board: Board, title: string): Promise<Ref> {
  const row = await findByTitle(board, title);
  if (!row) throw new Error(`missing ${board} post "${title}"`);
  return { board, id: row.id, title: row.title, hasImage: !!row.imageUrl };
}

async function refAnyBoard(title: string): Promise<Ref> {
  const lost = await findByTitle("lost", title);
  return lost ? ref("lost", title) : ref("found", title);
}

async function main() {
  assertPreviewOnly();
  const imageDir = process.argv[2];
  if (!imageDir) throw new Error("usage: add-batch3.ts <imageDir>");
  const now = Date.now();
  const users = await ensureUsers(now);

  const jobs = allJobs3().sort((a, b) => b.spec.createdAgoH - a.spec.createdAgoH);
  let added = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (await createPost(job.board, job.key, job.spec, users[(i * 5 + 3) % users.length].id, now, 2 + ((i * 29) % 60), imageDir)) added++;
  }
  console.log(`Added ${added} posts.`);
  const cleared = await prisma.matchCandidateCache.deleteMany({});
  console.log(`Cleared ${cleared.count} derived recommendation-cache rows.`);

  // ---------- ground truth ----------
  const gtFile = path.join(process.cwd(), "docs", "ai-eval-seed", "ground-truth.json");
  const gt = JSON.parse(await readFile(gtFile, "utf8"));

  // Existing hard negatives that also confuse a new pair.
  const existingNegByTitle = new Map<string, { confusableWith: string[] }>(gt.hardNegatives.map((n: { title: string; confusableWith: string[] }) => [n.title, n]));
  for (const p of PAIRS3) {
    for (const t of p.existingConfusers ?? []) {
      const n = existingNegByTitle.get(t);
      if (n && !n.confusableWith.includes(p.pairId)) n.confusableWith.push(p.pairId);
    }
  }

  for (const p of PAIRS3) {
    const lost = await ref("lost", p.lost.title);
    const found = await ref("found", p.found.title);
    const existingConfusers = await Promise.all((p.existingConfusers ?? []).map(refAnyBoard));
    gt.pairs.push({
      pairId: p.pairId,
      batch: "batch3",
      itemType: p.itemType,
      difficulty: p.difficulty,
      locationRelation: p.locationRelation,
      timeRelation: p.timeRelation,
      keyClues: p.keyClues,
      challenges: p.challenges,
      lost: { id: lost.id, title: lost.title, hasImage: lost.hasImage },
      found: { id: found.id, title: found.title, hasImage: found.hasImage },
      hardNegatives: NEGATIVES3.filter((n) => n.confusableWith.includes(p.pairId)).map((n) => n.negId),
      existingConfusers,
      // Evaluation inputs only (no ranks) -- measured by evaluate.ts.
      results: {
        semanticByDemoQuery: p.searchQuery ? { query: p.searchQuery } : null,
        imageSearch: QUERY_IMAGES3[p.pairId] ? { queryImage: `${p.pairId}.jpg` } : null,
      },
    });
  }
  // New negatives can also confuse an older pair (e.g. G01 -> P08).
  for (const n of NEGATIVES3) {
    for (const pairId of n.confusableWith) {
      const pair = gt.pairs.find((x: { pairId: string }) => x.pairId === pairId);
      if (pair && !pair.hardNegatives.includes(n.negId)) pair.hardNegatives.push(n.negId);
    }
    const r = await ref(n.board, n.post.title);
    gt.hardNegatives.push({ negId: n.negId, batch: "batch3", board: n.board, id: r.id, title: r.title, itemType: n.itemType, confusableWith: n.confusableWith, challenges: n.challenges, whyNotMatch: n.whyNotMatch, hasImage: r.hasImage });
  }
  for (const m of NO_MATCH3) {
    const r = await ref(m.board, m.post.title);
    gt.noMatch.push({ noMatchId: m.noMatchId, batch: "batch3", board: m.board, id: r.id, title: r.title, nearestTheme: m.nearestTheme, proximity: m.proximity, hasImage: r.hasImage });
  }

  // Flat per-post index over every benchmark post (all batches).
  const posts: Record<string, unknown>[] = [];
  for (const p of gt.pairs) {
    for (const side of ["lost", "found"] as const) {
      const other = side === "lost" ? "found" : "lost";
      const r = await ref(side, p[side].title);
      p[side].hasImage = r.hasImage;
      posts.push({
        board: side, id: r.id, title: r.title, batch: p.batch, role: "answer", pairId: p.pairId, difficulty: p.difficulty,
        answer: { board: other, id: p[other].id }, isHardNegative: false, isNoMatch: false, hasImage: r.hasImage,
      });
    }
  }
  for (const n of gt.hardNegatives) {
    const r = await ref(n.board, n.title);
    n.hasImage = r.hasImage;
    posts.push({ board: n.board, id: r.id, title: r.title, batch: n.batch, role: "hardNegative", negId: n.negId, confusableWith: n.confusableWith, isHardNegative: true, isNoMatch: false, hasImage: r.hasImage });
  }
  for (const m of gt.noMatch) {
    const r = await ref(m.board, m.title);
    m.hasImage = r.hasImage;
    posts.push({ board: m.board, id: r.id, title: r.title, batch: m.batch ?? "batch2", role: "noMatch", noMatchId: m.noMatchId, isHardNegative: false, isNoMatch: true, hasImage: r.hasImage });
  }

  const [lostN, foundN, lostImg, foundImg] = await Promise.all([
    prisma.lostPost.count(), prisma.foundPost.count(),
    prisma.lostPost.count({ where: { imageUrl: { not: null } } }), prisma.foundPost.count({ where: { imageUrl: { not: null } } }),
  ]);
  const summary = {
    lostPosts: lostN, foundPosts: foundN, total: lostN + foundN, withImage: lostImg + foundImg,
    pairs: gt.pairs.length, hardNegatives: gt.hardNegatives.length, noMatch: gt.noMatch.length, indexedPosts: posts.length,
  };
  if (summary.indexedPosts !== summary.total) console.warn(`WARNING: ${summary.total} posts in DB but ${summary.indexedPosts} indexed`);

  await writeFile(
    gtFile,
    JSON.stringify(
      {
        environment: `Preview (${PREVIEW_REF})`,
        generatedAt: new Date(now).toISOString(),
        note:
          "서비스 DB 스키마와 무관한 평가용 metadata. 이미지는 코드로 그린 합성 이미지이며 실사진이 아님. " +
          "batch0~2 pairs[].results의 순위는 D3 적용 전 알고리즘으로 측정한 과거 스냅샷이며, 현재 성능은 scripts/ai-eval-seed/evaluate.ts로 다시 측정한다. " +
          "batch3 pairs[].results는 평가 입력(시연 문장, 쿼리 이미지)만 담는다. posts[]는 전체 게시글의 역할 색인이다.",
        summary,
        pairs: gt.pairs,
        hardNegatives: gt.hardNegatives,
        noMatch: gt.noMatch,
        posts,
      },
      null,
      2,
    ),
  );
  console.log("SUMMARY", JSON.stringify(summary));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
