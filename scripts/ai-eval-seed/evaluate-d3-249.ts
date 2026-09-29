// Read-only D3 baseline on the expanded Preview benchmark (ground-truth.json:
// 56 pairs, 87 hard negatives, 50 no-match, 249 posts). Uses the app's own
// functions unchanged and writes nothing to the DB:
//   rec_lost_to_found / rec_found_to_lost : computeRecommendationRanking() (no cache write), top 5
//   semantic_title / semantic_fulltext / semantic_demo : searchPostsAI(found, text)       (D3 display)
//   image      : searchPostsAI(found, undefined, query photo)
//   text_image : searchPostsAI(found, demo query ?? lost title, query photo)  (D3-pool)
// Plus answer / no-match AI 유사도 distributions and a No-match threshold
// sweep (analysis only -- nothing is applied to the app).
//
// "Confuser above the answer" is reported three ways, never reclassifying a
// post: (1) hardNegatives only (the original metric), (2) + the pair's
// crossPairConfusers (another pair's answer post that competes with this
// one), (3) + other pairs' answer posts listed in a batch-3 pair's
// existingConfusers (reference only).
// Run with: npx tsx --env-file=.env.preview.local scripts/ai-eval-seed/evaluate-d3-249.ts [out.json]
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db/prisma";
import { aiSimilarity } from "@/lib/ai/rankFusion";
import { findCandidateCosines } from "@/lib/ai/vectorSearch";
import { searchPostsAI } from "@/lib/posts/aiService";
import { computeRecommendationRanking } from "@/lib/recommendation/service";
import type { PostType } from "@/lib/posts/schema";

const PREVIEW_REF = "swqvlihgupranzfzjevb";
const THRESHOLDS = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5];
const METHODS = ["rec_lost_to_found", "rec_found_to_lost", "semantic_title", "semantic_fulltext", "semantic_demo", "image", "text_image"] as const;
type Method = (typeof METHODS)[number];

type GtPair = {
  pairId: string; batch: string; difficulty: "easy" | "medium" | "hard";
  lost: { id: number; title: string }; found: { id: number; title: string; hasImage: boolean };
  results: { semanticByDemoQuery: { query: string } | null; imageSearch: { queryImage: string } | null };
  crossPairConfusers?: { board: PostType; id: number }[];
  existingConfusers?: { board: PostType; id: number }[];
};
type Confusers = { hardNegatives: Set<number>; crossPair: Set<number>; existingAnswers: Set<number> };
type Hit = { id: number; score: number };
type Row = { method: Method; pairId: string; batch: string; difficulty: string; rank: number | null; hnAbove: boolean | null; withCrossAbove: boolean | null; withExistingAbove: boolean | null; answerScore: number | null; top1Score: number | null };

const r3 = (x: number) => +x.toFixed(3);
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.round(p * (s.length - 1))];
};
const dist = (xs: number[]) =>
  xs.length ? { n: xs.length, min: r3(Math.min(...xs)), p10: r3(q(xs, 0.1)), p25: r3(q(xs, 0.25)), p50: r3(q(xs, 0.5)), p75: r3(q(xs, 0.75)), p90: r3(q(xs, 0.9)), max: r3(Math.max(...xs)) } : { n: 0 };
function metrics(ranks: (number | null)[]) {
  const n = ranks.length || 1;
  const at = (k: number) => r3(ranks.filter((r) => r !== null && r <= k).length / n);
  return { n: ranks.length, top1: at(1), recall3: at(3), recall5: at(5), mrr: r3(ranks.reduce<number>((s, r) => s + (r ? 1 / r : 0), 0) / n) };
}

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes(PREVIEW_REF)) throw new Error("Refusing to run: not the Preview DB.");
  const gt = JSON.parse(await readFile(path.join(process.cwd(), "docs", "ai-eval-seed", "ground-truth.json"), "utf8"));
  const pairs: GtPair[] = gt.pairs;
  const negsFor = (pairId: string, board: PostType) =>
    new Set<number>(gt.hardNegatives.filter((n: { board: string; confusableWith: string[] }) => n.board === board && n.confusableWith.includes(pairId)).map((n: { id: number }) => n.id));
  const answerPostKeys = new Set(pairs.flatMap((p) => [`lost:${p.lost.id}`, `found:${p.found.id}`]));
  const confusersFor = (p: GtPair, board: PostType): Confusers => ({
    hardNegatives: negsFor(p.pairId, board),
    crossPair: new Set((p.crossPairConfusers ?? []).filter((c) => c.board === board).map((c) => c.id)),
    existingAnswers: new Set((p.existingConfusers ?? []).filter((c) => c.board === board && answerPostKeys.has(`${c.board}:${c.id}`)).map((c) => c.id)),
  });

  const lostRows = await prisma.lostPost.findMany({ where: { id: { in: pairs.map((p) => p.lost.id) } }, select: { id: true, description: true } });
  const lostDesc = new Map(lostRows.map((r) => [r.id, r.description]));
  const queryImage = async (file: string) =>
    new Blob([new Uint8Array(await readFile(path.join(process.cwd(), "docs", "ai-eval-seed", "query-images", file)))], { type: "image/jpeg" });

  const rows: Row[] = [];
  const answerD3: { pairId: string; batch: string; direction: string; score: number }[] = [];
  // For the threshold sweep: every recommendation list shown, pair or no-match.
  const recLists: { kind: "pair" | "noMatch"; label: string; items: Hit[]; answerId: number | null }[] = [];
  const semLists: { kind: "pair" | "noMatch"; label: string; items: Hit[]; answerId: number | null }[] = [];

  const push = (method: Method, p: GtPair, list: Hit[], answerId: number, c: Confusers) => {
    const idx = list.findIndex((h) => h.id === answerId);
    const rank = idx < 0 ? null : idx + 1;
    const above = rank === null ? list : list.slice(0, rank - 1);
    const anyAbove = (ids: Set<number>) => (ids.size ? above.some((h) => ids.has(h.id)) : null);
    const withCross = new Set([...c.hardNegatives, ...c.crossPair]);
    rows.push({
      method, pairId: p.pairId, batch: p.batch, difficulty: p.difficulty, rank,
      hnAbove: anyAbove(c.hardNegatives),
      withCrossAbove: anyAbove(withCross),
      withExistingAbove: anyAbove(new Set([...withCross, ...c.existingAnswers])),
      answerScore: idx < 0 ? null : list[idx].score, top1Score: list[0]?.score ?? null,
    });
  };

  for (const p of pairs) {
    // Recommendation, both directions.
    for (const [method, src, srcId, answerId, board] of [
      ["rec_lost_to_found", "lost", p.lost.id, p.found.id, "found"],
      ["rec_found_to_lost", "found", p.found.id, p.lost.id, "lost"],
    ] as const) {
      const list = await computeRecommendationRanking(src, srcId);
      push(method, p, list, answerId, confusersFor(p, board));
      recLists.push({ kind: "pair", label: `${p.pairId} ${method}`, items: list, answerId });
      const [c] = await findCandidateCosines(src, srcId, [answerId]);
      answerD3.push({ pairId: p.pairId, batch: p.batch, direction: method, score: aiSimilarity(c.text, c.image)!.score });
    }

    const negsFound = confusersFor(p, "found");
    const search = async (text: string | undefined, image: Blob | undefined) =>
      (await searchPostsAI("found", text, image, { page: 1, limit: 10 })).items.map((i) => ({ id: i.id, score: i.score ?? 0 }));

    const byTitle = await search(p.lost.title, undefined);
    push("semantic_title", p, byTitle, p.found.id, negsFound);
    semLists.push({ kind: "pair", label: p.pairId, items: byTitle, answerId: p.found.id });
    push("semantic_fulltext", p, await search(`${p.lost.title} ${lostDesc.get(p.lost.id) ?? ""}`.slice(0, 100), undefined), p.found.id, negsFound);
    const demo = p.results.semanticByDemoQuery?.query;
    if (demo) push("semantic_demo", p, await search(demo, undefined), p.found.id, negsFound);
    if (p.results.imageSearch && p.found.hasImage) {
      const img = await queryImage(p.results.imageSearch.queryImage);
      push("image", p, await search(undefined, img), p.found.id, negsFound);
      push("text_image", p, await search(demo ?? p.lost.title, img), p.found.id, negsFound);
    }
    console.log(`${p.pairId} done`);
  }

  const noMatchOut = [];
  for (const m of gt.noMatch as { noMatchId: string; board: PostType; id: number; title: string; batch?: string; proximity?: string }[]) {
    const list = await computeRecommendationRanking(m.board, m.id);
    recLists.push({ kind: "noMatch", label: m.noMatchId, items: list, answerId: null });
    const other: PostType = m.board === "lost" ? "found" : "lost";
    const sem = (await searchPostsAI(other, m.title, undefined, { page: 1, limit: 10 })).items.map((i) => ({ id: i.id, score: i.score ?? 0 }));
    semLists.push({ kind: "noMatch", label: m.noMatchId, items: sem, answerId: null });
    noMatchOut.push({ noMatchId: m.noMatchId, title: m.title, batch: m.batch ?? "batch2", proximity: m.proximity ?? null, recTop1: list[0]?.score ?? null, semanticTop1: sem[0]?.score ?? null });
  }

  // ---------- aggregation ----------
  const sel = (method: Method, f: (r: Row) => boolean = () => true) => rows.filter((r) => r.method === method && f(r));
  const byMethod = (f?: (r: Row) => boolean) => Object.fromEntries(METHODS.map((m) => [m, metrics(sel(m, f).map((r) => r.rank))]));
  const aboveRate = (m: Method, key: "hnAbove" | "withCrossAbove" | "withExistingAbove") => {
    const rs = sel(m).filter((r) => r[key] !== null);
    const above = rs.filter((r) => r[key]);
    return { pairs: rs.length, above: above.length, rate: r3(above.length / (rs.length || 1)), abovePairIds: above.map((r) => r.pairId) };
  };
  const hn = (m: Method) => aboveRate(m, "hnAbove");

  // Threshold sweep over shown lists: a candidate is shown only if score >= t.
  const sweep = (lists: typeof recLists) =>
    THRESHOLDS.map((t) => {
      const pairL = lists.filter((l) => l.kind === "pair");
      const nmL = lists.filter((l) => l.kind === "noMatch");
      const shown = (l: (typeof lists)[number]) => l.items.filter((h) => h.score >= t);
      const answerShown = pairL.filter((l) => shown(l).some((h) => h.id === l.answerId)).length;
      const answerInListBefore = pairL.filter((l) => l.items.some((h) => h.id === l.answerId)).length;
      const shownItems = lists.reduce((s, l) => s + shown(l).length, 0);
      const sourcesShown = lists.filter((l) => shown(l).length > 0);
      return {
        threshold: t,
        noMatchSuppressed: r3(nmL.filter((l) => shown(l).length === 0).length / nmL.length),
        answersDropped: r3((answerInListBefore - answerShown) / (answerInListBefore || 1)),
        recall: r3(answerShown / pairL.length),
        itemPrecision: r3(answerShown / (shownItems || 1)),
        sourcePrecision: r3(sourcesShown.filter((l) => l.answerId !== null && shown(l).some((h) => h.id === l.answerId)).length / (sourcesShown.length || 1)),
        pairListsEmptied: r3(pairL.filter((l) => shown(l).length === 0).length / pairL.length),
        avgShownPerNoMatch: r3(nmL.reduce((s, l) => s + shown(l).length, 0) / nmL.length),
      };
    });

  const result = {
    environment: `Preview (${PREVIEW_REF})`,
    evaluatedAt: new Date().toISOString(),
    algorithm: "D3 (b_text=0.361, b_image=0.657), D3-pool recommendation / text+image search; single-signal search ranks unchanged",
    benchmark: gt.summary,
    overall: byMethod(),
    originalPairsOnly: byMethod((r) => r.batch !== "batch3"),
    newPairsOnly: byMethod((r) => r.batch === "batch3"),
    byDifficulty: Object.fromEntries(["easy", "medium", "hard"].map((d) => [d, byMethod((r) => r.difficulty === d)])),
    hardNegativeAboveAnswer: Object.fromEntries(METHODS.map((m) => [m, hn(m)])),
    confuserAboveAnswer: Object.fromEntries(
      METHODS.map((m) => [m, { hardNegativesOnly: hn(m), withCrossPair: aboveRate(m, "withCrossAbove"), withCrossPairAndExistingAnswers: aboveRate(m, "withExistingAbove") }]),
    ),
    answerD3: {
      all: dist(answerD3.map((a) => a.score)),
      original: dist(answerD3.filter((a) => a.batch !== "batch3").map((a) => a.score)),
      new: dist(answerD3.filter((a) => a.batch === "batch3").map((a) => a.score)),
    },
    noMatchTop1D3: {
      recommendation: dist(noMatchOut.map((m) => m.recTop1).filter((x): x is number => x !== null)),
      recommendationNear: dist(noMatchOut.filter((m) => m.proximity === "near").map((m) => m.recTop1!).filter((x) => x !== null)),
      recommendationFar: dist(noMatchOut.filter((m) => m.proximity === "far").map((m) => m.recTop1!).filter((x) => x !== null)),
      semanticSearch: dist(noMatchOut.map((m) => m.semanticTop1).filter((x): x is number => x !== null)),
      semanticShownRate: r3(noMatchOut.filter((m) => m.semanticTop1 !== null).length / noMatchOut.length),
      items: noMatchOut,
    },
    thresholdSweep: { recommendation: sweep(recLists), semanticSearchByTitle: sweep(semLists) },
    rows,
  };
  const out = path.resolve(process.argv[2] ?? path.join(process.cwd(), "docs", "ai-eval-seed", "baseline-d3-249-2026-09-29.json"));
  await writeFile(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, rows: undefined, noMatchTop1D3: { ...result.noMatchTop1D3, items: undefined } }, null, 1));
  console.log(`Wrote ${out}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
