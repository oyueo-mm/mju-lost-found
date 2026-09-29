// Computes missing image embeddings for already-uploaded seed images using
// the real embedPostImageBestEffort(), clears the (derived) recommendation
// cache, then prints real recommendation / semantic search / image search
// results for the 4 demo scenarios. Does not import sharp (see
// render-query-images.ts for why).
// Run with: npx tsx --env-file=.env.preview.local scripts/ai-eval-seed/finish-demo.ts
import { readFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db/prisma";
import { embedPostImageBestEffort } from "@/lib/ai/postEmbedding";
import { findPostRecommendations } from "@/lib/recommendation/service";
import { searchPosts, searchPostsAI, searchPostsByImage } from "@/lib/posts/aiService";

import { DEMOS, PAIRS } from "./data";

const PREVIEW_REF = "swqvlihgupranzfzjevb";

const SCENARIOS = [
  { demoId: "DEMO-3", pairId: "P08" },
  { demoId: "DEMO-1", pairId: "P01" },
  { demoId: "DEMO-6", pairId: "P17" },
  { demoId: "DEMO-4", pairId: "P11" },
];

const fmt = (items: { id: number; title: string; score?: number }[]) =>
  items.map((r) => `#${r.id} ${r.title} (${(r.score ?? 0).toFixed(3)})`).join("\n      ") || "(결과 없음)";

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes(PREVIEW_REF) || !(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PREVIEW_REF)) {
    throw new Error("Refusing to run: not the Preview project.");
  }

  for (const board of ["lost", "found"] as const) {
    const rows =
      board === "lost"
        ? await prisma.$queryRaw<{ id: number; image_url: string }[]>`SELECT id, image_url FROM "LostPost" WHERE image_url IS NOT NULL AND "imageEmbedding" IS NULL`
        : await prisma.$queryRaw<{ id: number; image_url: string }[]>`SELECT id, image_url FROM "FoundPost" WHERE image_url IS NOT NULL AND "imageEmbedding" IS NULL`;
    for (const row of rows) {
      await embedPostImageBestEffort(board, row.id, row.image_url);
      console.log(`  image embedding ${board} #${row.id}`);
    }
  }
  await prisma.matchCandidateCache.deleteMany({});
  const missing = await prisma.$queryRaw<{ n: bigint }[]>`SELECT (SELECT count(*) FROM "LostPost" WHERE image_url IS NOT NULL AND "imageEmbedding" IS NULL) + (SELECT count(*) FROM "FoundPost" WHERE image_url IS NOT NULL AND "imageEmbedding" IS NULL) AS n`;
  console.log(`Missing image embeddings now: ${missing[0].n}`);

  for (const s of SCENARIOS) {
    const demo = DEMOS.find((d) => d.demoId === s.demoId)!;
    const pair = PAIRS.find((p) => p.pairId === s.pairId)!;
    const lost = await prisma.lostPost.findFirstOrThrow({ where: { title: pair.lost.title } });
    const found = await prisma.foundPost.findFirstOrThrow({ where: { title: pair.found.title } });
    console.log(`\n## ${demo.demoId} ${demo.name} — 분실 #${lost.id} "${lost.title}" → 정답 습득 #${found.id} "${found.title}"`);

    const recs = await findPostRecommendations("lost", lost.id);
    console.log(`  [AI 추천 (분실글 상세)]\n      ${fmt(recs)}`);

    const sem = await searchPosts({ type: "found", mode: "semantic", q: demo.searchQuery, page: 1, limit: 10 });
    console.log(`  [AI 의미검색 "${demo.searchQuery}"]\n      ${fmt(sem.items)}`);

    const jpg = await readFile(path.join(process.cwd(), "docs", "ai-eval-seed", "query-images", `${demo.demoId}.jpg`));
    const blob = new Blob([new Uint8Array(jpg)], { type: "image/jpeg" });
    const img = await searchPostsByImage("found", blob, { page: 1, limit: 10 });
    console.log(`  [이미지 검색 ${demo.demoId}.jpg]\n      ${fmt(img.items)}`);

    const both = await searchPostsAI("found", demo.searchQuery, blob, { page: 1, limit: 10 });
    console.log(`  [텍스트+이미지 AI 검색]\n      ${fmt(both.items)}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
