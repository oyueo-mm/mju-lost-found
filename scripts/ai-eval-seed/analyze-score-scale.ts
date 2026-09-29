// Read-only analysis: how recommendation display scores would look under
// candidate absolute-score definitions, on the fixed Preview benchmark.
// The ranking itself is always the current one (findSimilarPosts +
// findSimilarPostsByImage + combineRankings, top 5); only the displayed
// number is recomputed from raw cosine. Writes nothing to the DB.
// Run with: npx tsx --env-file=.env.preview.local scripts/ai-eval-seed/analyze-score-scale.ts
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db/prisma";
import { combineRankings } from "./legacyRankFusion";
import { findSimilarPosts, findSimilarPostsByImage } from "@/lib/ai/vectorSearch";
import type { PostType } from "@/lib/posts/schema";

const PREVIEW_REF = "swqvlihgupranzfzjevb";
type Pair = { lostId: number; foundId: number; text: number; image: number | null };

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const r3 = (x: number | null | undefined) => (x === null || x === undefined ? null : +x.toFixed(3));
// AUC: probability a random positive outranks a random negative.
const auc = (pos: number[], neg: number[]) => {
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (pos.length * neg.length || 1);
};

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes(PREVIEW_REF)) throw new Error("Refusing to run: not the Preview DB.");
  const gt = JSON.parse(await readFile(path.join(process.cwd(), "docs", "ai-eval-seed", "ground-truth.json"), "utf8"));

  // Every cross-board cosine, both modalities (image only where both sides have one).
  const rows = await prisma.$queryRaw<{ lost_id: number; found_id: number; text: number; image: number | null }[]>`
    SELECT lp.id AS lost_id, fp.id AS found_id,
           1 - (lp.embedding <=> fp.embedding) AS text,
           CASE WHEN lp."imageEmbedding" IS NOT NULL AND fp."imageEmbedding" IS NOT NULL
                THEN 1 - (lp."imageEmbedding" <=> fp."imageEmbedding") END AS image
    FROM "LostPost" lp CROSS JOIN "FoundPost" fp
    WHERE lp.embedding IS NOT NULL AND fp.embedding IS NOT NULL`;
  const pairs: Pair[] = rows.map((r) => ({ lostId: r.lost_id, foundId: r.found_id, text: Number(r.text), image: r.image === null ? null : Number(r.image) }));
  const cos = (src: PostType, srcId: number, candId: number) =>
    pairs.find((p) => (src === "lost" ? p.lostId === srcId && p.foundId === candId : p.foundId === srcId && p.lostId === candId))!;

  const answerKeys = new Set(gt.pairs.map((p: { lost: { id: number }; found: { id: number } }) => `${p.lost.id}-${p.found.id}`));
  const bgText = pairs.filter((p) => !answerKeys.has(`${p.lostId}-${p.foundId}`)).map((p) => p.text);
  const bgImage = pairs.filter((p) => p.image !== null && !answerKeys.has(`${p.lostId}-${p.foundId}`)).map((p) => p.image!);
  const ansText = pairs.filter((p) => answerKeys.has(`${p.lostId}-${p.foundId}`)).map((p) => p.text);
  const ansImage = pairs.filter((p) => p.image !== null && answerKeys.has(`${p.lostId}-${p.foundId}`)).map((p) => p.image!);
  const dist = (xs: number[]) => ({ n: xs.length, min: r3(Math.min(...xs)), p10: r3(q(xs, 0.1)), p50: r3(q(xs, 0.5)), p90: r3(q(xs, 0.9)), p99: r3(q(xs, 0.99)), max: r3(Math.max(...xs)) });

  const bText = q(bgText, 0.5);
  const bImage = q(bgImage, 0.5);
  const calib = (c: number, b: number) => Math.max(0, Math.min(1, (c - b) / (1 - b)));

  // Candidate display definitions; each takes raw cosines of one candidate.
  const defs: Record<string, (t: number, i: number | null) => number> = {
    D1_meanNormalized: (t, i) => mean([(t + 1) / 2, ...(i === null ? [] : [(i + 1) / 2])]),
    D2_meanCosine: (t, i) => mean([t, ...(i === null ? [] : [i])]),
    D3_calibratedMean: (t, i) => mean([calib(t, bText), ...(i === null ? [] : [calib(i, bImage)])]),
    D4_textOnlyCosine: (t) => t,
  };

  type Item = { src: PostType; srcId: number; rank: number; candId: number; current: number; text: number; image: number | null; answer: boolean };
  const lists: { kind: "pair" | "noMatch"; label: string; items: Item[] }[] = [];
  const sources: { kind: "pair" | "noMatch"; label: string; src: PostType; id: number; answerId?: number }[] = [];
  for (const p of gt.pairs) {
    sources.push({ kind: "pair", label: `${p.pairId} L→F`, src: "lost", id: p.lost.id, answerId: p.found.id });
    sources.push({ kind: "pair", label: `${p.pairId} F→L`, src: "found", id: p.found.id, answerId: p.lost.id });
  }
  for (const m of gt.noMatch) sources.push({ kind: "noMatch", label: `${m.noMatchId} ${m.title}`, src: m.board, id: m.id });

  for (const s of sources) {
    const [t, i] = await Promise.all([findSimilarPosts(s.src, s.id, 5).catch(() => []), findSimilarPostsByImage(s.src, s.id, 5)]);
    const ranking = combineRankings(t, i).slice(0, 5);
    lists.push({
      kind: s.kind,
      label: s.label,
      items: ranking.map((r, idx) => {
        const c = cos(s.src, s.id, r.id);
        return { src: s.src, srcId: s.id, rank: idx + 1, candId: r.id, current: r.score, text: c.text, image: c.image, answer: r.id === s.answerId };
      }),
    });
  }

  const evaluate = (fn: (it: Item) => number) => {
    const answerScores = lists.flatMap((l) => l.items.filter((it) => it.answer)).map(fn);
    const wrongTop1 = lists.filter((l) => l.kind === "pair" && l.items[0] && !l.items[0].answer).map((l) => fn(l.items[0]));
    const noMatchTop1 = lists.filter((l) => l.kind === "noMatch" && l.items[0]).map((l) => fn(l.items[0]));
    const nonAnswer = lists.flatMap((l) => l.items.filter((it) => !it.answer)).map(fn);
    let inversions = 0;
    let listsWithInversion = 0;
    for (const l of lists) {
      let has = false;
      for (let k = 1; k < l.items.length; k++) if (fn(l.items[k]) > fn(l.items[k - 1]) + 1e-9) { inversions++; has = true; }
      if (has) listsWithInversion++;
    }
    const top1All = lists.filter((l) => l.items[0]).map((l) => fn(l.items[0]));
    return {
      answer: dist(answerScores),
      noMatchTop1: dist(noMatchTop1),
      wrongTop1InPairs: wrongTop1.length ? dist(wrongTop1) : null,
      allNonAnswerShown: dist(nonAnswer),
      aucAnswerVsNoMatchTop1: +auc(answerScores, noMatchTop1).toFixed(3),
      aucAnswerVsAllNonAnswer: +auc(answerScores, nonAnswer).toFixed(3),
      top1Displayed1000: top1All.filter((x) => x >= 0.9995).length,
      adjacentInversions: inversions,
      listsWithInversion: `${listsWithInversion}/${lists.length}`,
    };
  };

  const withImg = lists.flatMap((l) => l.items).filter((it) => it.image !== null);
  const result = {
    environment: `Preview (${PREVIEW_REF})`,
    evaluatedAt: new Date().toISOString(),
    rawCosine: {
      textBackground: dist(bgText), textAnswer: dist(ansText),
      imageBackground: dist(bgImage), imageAnswer: dist(ansImage),
    },
    calibrationBaselines: { textP50: r3(bText), imageP50: r3(bImage) },
    shownCandidates: { total: lists.flatMap((l) => l.items).length, withBothImages: withImg.length },
    definitions: {
      D0_current: evaluate((it) => it.current),
      ...Object.fromEntries(Object.entries(defs).map(([k, fn]) => [k, evaluate((it) => fn(it.text, it.image))])),
    },
    lists: lists.map((l) => ({
      label: l.label,
      items: l.items.map((it) => ({ rank: it.rank, id: it.candId, answer: it.answer, current: r3(it.current), textCos: r3(it.text), imageCos: r3(it.image), ...(Object.fromEntries(Object.entries(defs).map(([k, fn]) => [k, r3(fn(it.text, it.image))])) as Record<keyof typeof defs, number | null>) })),
    })),
  };
  const out = path.join(process.cwd(), "docs", "ai-eval-seed", "score-scale-analysis-2026-09-29.json");
  await writeFile(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ rawCosine: result.rawCosine, calibrationBaselines: result.calibrationBaselines, shownCandidates: result.shownCandidates, definitions: result.definitions }, null, 1));
  for (const l of result.lists.filter((x) => x.label.startsWith("M") || ["P08 L→F", "P01 L→F", "P26 L→F", "Q08 L→F"].includes(x.label)))
    console.log(l.label, l.items.map((i: Record<string, unknown>) => `${i.rank}${i.answer ? "*" : ""} cur${i.current} t${i.textCos} i${i.imageCos} D1 ${i.D1_meanNormalized} D3 ${i.D3_calibratedMean}`).join(" | "));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
