// Read-only check of AI 검색 (searchPostsAI) after the D3 unification:
//   1. text + image: current D3-pool vs the pre-D3 min-max fusion, on every
//      benchmark pair that has both a demo query sentence and a query photo.
//   2. text only: how often the displayed AI 유사도 is not monotonic with
//      the result order (only the title bonus can cause that).
// Run with: npx tsx --env-file=.env.preview.local scripts/ai-eval-seed/check-ai-search-d3.ts
import { readFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db/prisma";
import { getEmbeddingProvider } from "@/lib/ai/embedding";
import { getImageEmbeddingProvider } from "@/lib/ai/imageEmbedding";
import { findPostsByImageQuery, findPostsBySemanticQuery } from "@/lib/ai/vectorSearch";
import { filterAiSearchResults, searchPostsAI } from "@/lib/posts/aiService";
import { combineRankings } from "./legacyRankFusion";

const PREVIEW_REF = "swqvlihgupranzfzjevb";

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes(PREVIEW_REF)) throw new Error("Refusing to run: not the Preview DB.");
  const gt = JSON.parse(await readFile(path.join(process.cwd(), "docs", "ai-eval-seed", "ground-truth.json"), "utf8"));

  console.log("== text + image AI 검색 (found board) ==");
  for (const p of gt.pairs.filter((x: { results: { semanticByDemoQuery: unknown; imageSearch: unknown } }) => x.results.semanticByDemoQuery && x.results.imageSearch)) {
    const q: string = p.results.semanticByDemoQuery.query;
    const jpg = await readFile(path.join(process.cwd(), "docs", "ai-eval-seed", "query-images", p.results.imageSearch.queryImage));
    const blob = new Blob([new Uint8Array(jpg)], { type: "image/jpeg" });

    const after = await searchPostsAI("found", q, blob, { page: 1, limit: 10 });
    const [tv, iv] = await Promise.all([getEmbeddingProvider().embed(q), getImageEmbeddingProvider().embed(blob)]);
    const [t, i] = await Promise.all([
      findPostsBySemanticQuery("found", tv, 10).then(filterAiSearchResults),
      findPostsByImageQuery("found", iv, 10).then(filterAiSearchResults),
    ]);
    const before = combineRankings(t, i);
    const rank = (ids: number[]) => {
      const k = ids.indexOf(p.found.id);
      return k < 0 ? null : k + 1;
    };
    console.log(
      `${p.pairId} "${q}" answer rank ${rank(before.map((r) => r.id))} -> ${rank(after.items.map((r) => r.id))}`,
      `| top1 before ${before[0].score.toFixed(2)} after ${after.items[0].score!.toFixed(2)} "${after.items[0].title}"`,
      `| answer after ${after.items.find((r) => r.id === p.found.id)?.score?.toFixed(2)}`,
    );
  }

  console.log("== text-only AI 검색: displayed AI 유사도 vs order ==");
  let lists = 0;
  let inverted = 0;
  let adjacent = 0;
  const queries: string[] = gt.pairs.flatMap((p: { lost: { title: string }; results: { semanticByDemoQuery: { query: string } | null } }) => [p.lost.title, ...(p.results.semanticByDemoQuery ? [p.results.semanticByDemoQuery.query] : [])]);
  for (const q of queries) {
    const res = await searchPostsAI("found", q, undefined, { page: 1, limit: 10 });
    const s = res.items.map((r) => r.score!);
    let bad = 0;
    for (let k = 1; k < s.length; k++) if (s[k] > s[k - 1] + 1e-9) bad++;
    lists++;
    adjacent += bad;
    if (bad) {
      inverted++;
      if (inverted <= 5) console.log(`  "${q}": ${res.items.slice(0, 4).map((r) => `${r.title} ${r.score!.toFixed(2)}`).join(" / ")}`);
    }
  }
  console.log(`lists with an inversion: ${inverted}/${lists}, adjacent inversions: ${adjacent}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
