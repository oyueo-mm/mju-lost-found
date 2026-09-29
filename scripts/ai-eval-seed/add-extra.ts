// Append-only: adds EXTRA_SCENARIOS posts to the Preview DB without
// touching any existing row (skips a post whose exact title already
// exists, so re-running never duplicates). Uses the real embedding /
// signed-upload / setPostImage / image-embedding code, then clears the
// derived recommendation cache (so existing posts' recommendations can see
// the new posts -- the cache is otherwise never invalidated by a new post
// on the opposite board) and re-checks the existing phone/wallet scenarios
// plus the new ones with the real search/recommendation functions.
// Run with: npx tsx --env-file=.env.preview.local scripts/ai-eval-seed/add-extra.ts <imageDir>
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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

import { DEMOS, NEGATIVES, PAIRS, POSTERS, type Board, type PostSpec } from "./data";
import { EXTRA_QUERIES, EXTRA_SCENARIOS } from "./extra-scenarios";

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
  for (let i = 0; i < 12; i++) {
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
            createdAt: new Date(now - 25 * 24 * 3600_000),
          },
        })),
    );
  }
  return users;
}

async function createPost(board: Board, key: string, spec: PostSpec, userId: number, now: number, viewCount: number, imageDir: string) {
  const existing =
    board === "lost"
      ? await prisma.lostPost.findFirst({ where: { title: spec.title } })
      : await prisma.foundPost.findFirst({ where: { title: spec.title } });
  if (existing) {
    console.log(`  (skip, exists) ${board} #${existing.id} ${spec.title}`);
    return { row: existing, created: false };
  }
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
    const jpg = await readFile(file);
    const { path: uploadPath, token } = await createSignedUploadUrl(buildImagePathname(board, row.id, "image/jpeg"));
    const { error } = await getSupabaseAdminClient().storage.from(POST_IMAGES_BUCKET).uploadToSignedUrl(uploadPath, token, jpg, { contentType: "image/jpeg" });
    if (error) throw new Error(`upload failed: ${error.message}`);
    const result = await setPostImage(board, row.id, userId, { path: uploadPath });
    if (result.kind !== "ok") throw new Error(`setPostImage failed: ${result.kind}`);
    await embedPostImageBestEffort(board, row.id, result.data.imageUrl);
    await invalidateRecommendationCache(board, row.id);
  }
  console.log(`  ${board} #${row.id} ${key} "${row.title}"${spec.image ? " [image]" : ""}`);
  return { row, created: true };
}

const rankOf = (items: { id: number }[], id: number) => {
  const i = items.findIndex((r) => r.id === id);
  return i < 0 ? "없음" : `${i + 1}위`;
};

async function check(label: string, pairId: string, query: string, queryImage?: string) {
  const pair = PAIRS.find((p) => p.pairId === pairId)!;
  const lost = await prisma.lostPost.findFirstOrThrow({ where: { title: pair.lost.title } });
  const found = await prisma.foundPost.findFirstOrThrow({ where: { title: pair.found.title } });
  const recs = await findPostRecommendations("lost", lost.id);
  const sem = await searchPosts({ type: "found", mode: "semantic", q: query, page: 1, limit: 10 });
  let img = "-";
  if (queryImage && existsSync(queryImage)) {
    const jpg = await readFile(queryImage);
    const res = await searchPostsByImage("found", new Blob([new Uint8Array(jpg)], { type: "image/jpeg" }), { page: 1, limit: 10 });
    img = rankOf(res.items, found.id);
  }
  const top = (items: { id: number; title: string; score?: number }[]) =>
    items.slice(0, 3).map((r) => `#${r.id} ${r.title}(${(r.score ?? 0).toFixed(3)})`).join(" / ");
  console.log(`\n[${label}] 분실 #${lost.id} → 정답 습득 #${found.id} "${found.title}"`);
  console.log(`  추천: ${rankOf(recs, found.id)}   | ${top(recs)}`);
  console.log(`  의미검색 "${query}": ${rankOf(sem.items, found.id)}   | ${top(sem.items)}`);
  console.log(`  이미지검색: ${img}`);
}

async function main() {
  assertPreviewOnly();
  const imageDir = process.argv[2];
  if (!imageDir) throw new Error("usage: add-extra.ts <imageDir>");
  const now = Date.now();
  const users = await ensureUsers(now);

  const jobs: { key: string; board: Board; spec: PostSpec }[] = [];
  for (const s of EXTRA_SCENARIOS) {
    const pair = PAIRS.find((p) => p.pairId === s.pairId)!;
    jobs.push({ key: `${s.pairId}-lost`, board: "lost", spec: pair.lost });
    jobs.push({ key: `${s.pairId}-found`, board: "found", spec: pair.found });
    for (const id of s.negIds) {
      const neg = NEGATIVES.find((n) => n.negId === id)!;
      jobs.push({ key: id, board: neg.board, spec: neg.post });
    }
  }
  jobs.sort((a, b) => b.spec.createdAgoH - a.spec.createdAgoH);

  let added = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const { created } = await createPost(job.board, job.key, job.spec, users[(i * 5 + 3) % users.length].id, now, 5 + ((i * 29) % 40), imageDir);
    if (created) added++;
  }
  console.log(`\nAdded ${added} posts.`);

  // Derived data only: a new post on the opposite board never invalidates
  // an existing post's cached recommendations, so clear it once.
  await prisma.matchCandidateCache.deleteMany({});

  const qi = (demoId: string) => path.join(process.cwd(), "docs", "ai-eval-seed", "query-images", `${demoId}.jpg`);
  console.log("\n===== 기존 시나리오 재확인 =====");
  for (const [label, pairId, demoId] of [["휴대폰", "P11", "DEMO-4"], ["지갑", "P01", "DEMO-1"], ["우산", "P17", "DEMO-6"], ["에어팟", "P08", "DEMO-3"]] as const) {
    await check(label, pairId, DEMOS.find((d) => d.demoId === demoId)!.searchQuery, qi(demoId));
  }
  console.log("\n===== 새 시나리오 =====");
  const demoByPair: Record<string, string> = { P05: "DEMO-2", P14: "DEMO-5", P20: "DEMO-7" };
  for (const s of EXTRA_SCENARIOS) {
    await check(s.name, s.pairId, EXTRA_QUERIES[s.pairId], demoByPair[s.pairId] ? qi(demoByPair[s.pairId]) : undefined);
  }

  const [lostN, foundN] = await Promise.all([prisma.lostPost.count(), prisma.foundPost.count()]);
  console.log(`\nTotals: LostPost ${lostN}, FoundPost ${foundN}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
