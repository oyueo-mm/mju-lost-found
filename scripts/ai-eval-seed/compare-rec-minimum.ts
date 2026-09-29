// Read-only: recommendation quality on the 249-post Preview benchmark before
// vs. after RECOMMENDATION_MIN_AI_SIMILARITY, using the app's own
// computeRecommendationRanking() (no cache write) and
// applyRecommendationMinimum() -- the exact filter findPostRecommendations()
// applies when reading. Writes nothing to the DB.
// Run with: npx tsx --env-file=.env.preview.local scripts/ai-eval-seed/compare-rec-minimum.ts
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db/prisma";
import { applyRecommendationMinimum, computeRecommendationRanking, RECOMMENDATION_MIN_AI_SIMILARITY } from "@/lib/recommendation/service";
import type { PostType } from "@/lib/posts/schema";

import { DEMOS } from "./data";

const PREVIEW_REF = "swqvlihgupranzfzjevb";
const r3 = (x: number) => +x.toFixed(3);
function metrics(ranks: (number | null)[]) {
  const n = ranks.length || 1;
  const at = (k: number) => r3(ranks.filter((r) => r !== null && r <= k).length / n);
  return { n: ranks.length, top1: at(1), recall3: at(3), recall5: at(5), mrr: r3(ranks.reduce<number>((s, r) => s + (r ? 1 / r : 0), 0) / n) };
}
const rankOf = (list: { id: number }[], id: number) => {
  const i = list.findIndex((h) => h.id === id);
  return i < 0 ? null : i + 1;
};

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes(PREVIEW_REF)) throw new Error("Refusing to run: not the Preview DB.");
  const gt = JSON.parse(await readFile(path.join(process.cwd(), "docs", "ai-eval-seed", "ground-truth.json"), "utf8"));
  const demoPairs = new Set(DEMOS.map((d) => d.pairId));

  const rows: { pairId: string; batch: string; difficulty: string; direction: string; before: number | null; after: number | null; answerScore: number | null; top1: number | null; shownAfter: number }[] = [];
  for (const p of gt.pairs as { pairId: string; batch: string; difficulty: string; lost: { id: number }; found: { id: number } }[]) {
    for (const [direction, src, srcId, answerId] of [
      ["L→F", "lost", p.lost.id, p.found.id],
      ["F→L", "found", p.found.id, p.lost.id],
    ] as const) {
      const full = await computeRecommendationRanking(src, srcId);
      const shown = applyRecommendationMinimum(full);
      rows.push({
        pairId: p.pairId, batch: p.batch, difficulty: p.difficulty, direction,
        before: rankOf(full, answerId), after: rankOf(shown, answerId),
        answerScore: full.find((h) => h.id === answerId)?.score ?? null, top1: full[0]?.score ?? null, shownAfter: shown.length,
      });
    }
  }

  const noMatch = [];
  for (const m of gt.noMatch as { noMatchId: string; board: PostType; id: number; title: string; proximity?: string }[]) {
    const full = await computeRecommendationRanking(m.board, m.id);
    const shown = applyRecommendationMinimum(full);
    noMatch.push({ noMatchId: m.noMatchId, title: m.title, proximity: m.proximity ?? "(batch2)", top1: full[0]?.score ?? null, shownBefore: full.length, shownAfter: shown.length });
  }

  const pick = (f: (r: (typeof rows)[number]) => boolean, key: "before" | "after") => metrics(rows.filter(f).map((r) => r[key]));
  const groups: Record<string, (r: (typeof rows)[number]) => boolean> = {
    "L→F": (r) => r.direction === "L→F",
    "F→L": (r) => r.direction === "F→L",
    easy: (r) => r.difficulty === "easy",
    medium: (r) => r.difficulty === "medium",
    hard: (r) => r.difficulty === "hard",
  };
  const pairLists = rows.length;
  const result = {
    environment: `Preview (${PREVIEW_REF})`,
    evaluatedAt: new Date().toISOString(),
    minimum: RECOMMENDATION_MIN_AI_SIMILARITY,
    metrics: Object.fromEntries(Object.entries(groups).map(([k, f]) => [k, { before: pick(f, "before"), after: pick(f, "after") }])),
    noMatchExposure: {
      before: r3(noMatch.filter((m) => m.shownBefore > 0).length / noMatch.length),
      after: r3(noMatch.filter((m) => m.shownAfter > 0).length / noMatch.length),
      avgShownBefore: r3(noMatch.reduce((s, m) => s + m.shownBefore, 0) / noMatch.length),
      avgShownAfter: r3(noMatch.reduce((s, m) => s + m.shownAfter, 0) / noMatch.length),
      stillShown: noMatch.filter((m) => m.shownAfter > 0).map((m) => `${m.noMatchId} ${m.title} (${m.top1?.toFixed(3)}, ${m.shownAfter}개)`),
    },
    pairListsEmptiedAfter: `${rows.filter((r) => r.shownAfter === 0).length}/${pairLists}`,
    answersLost: rows.filter((r) => r.before !== null && r.after === null).map((r) => `${r.pairId} ${r.direction} (${r.difficulty}) was #${r.before}, AI 유사도 ${r.answerScore?.toFixed(3)}`),
    demoScenarios: rows.filter((r) => demoPairs.has(r.pairId)).map((r) => ({ pairId: r.pairId, direction: r.direction, before: r.before, after: r.after, answerScore: r.answerScore && r3(r.answerScore), shownAfter: r.shownAfter })),
    rows,
    noMatch,
  };
  const out = path.join(process.cwd(), "docs", "ai-eval-seed", "rec-minimum-0.35-2026-09-29.json");
  await writeFile(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, rows: undefined, noMatch: undefined }, null, 1));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
