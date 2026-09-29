// Read-only comparison: current recommendation rank fusion vs ranking by
// the D3 absolute score, on the fixed Preview benchmark. Writes nothing to
// the DB and changes no app code.
//   current : findSimilarPosts + findSimilarPostsByImage (top 5 each) -> combineRankings -> top 5
//   D3-all  : every eligible opposite-board post scored by D3, sorted, top 5
//   D3-pool : the current fusion's own candidate union re-sorted by D3, top 5
// D3 = mean over signals both posts have of clamp01((cos - b) / (1 - b)).
// Run with: npx tsx --env-file=.env.preview.local scripts/ai-eval-seed/compare-d3-ranking.ts
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db/prisma";
import { combineRankings } from "./legacyRankFusion";
import { findSimilarPosts, findSimilarPostsByImage } from "@/lib/ai/vectorSearch";
import type { PostType } from "@/lib/posts/schema";

const PREVIEW_REF = "swqvlihgupranzfzjevb";
const B_TEXT = 0.361; // score-scale-analysis-2026-09-29.json: non-answer cross-board text cos p50
const B_IMAGE = 0.657; // same, image
const TOP_K = 5;

type Row = { lost_id: number; found_id: number; text: number; image: number | null; lost_ok: boolean; found_ok: boolean };
type GT = {
  pairs: { pairId: string; difficulty: string; lost: { id: number }; found: { id: number } }[];
  hardNegatives: { board: PostType; id: number; confusableWith: string[] }[];
  noMatch: { noMatchId: string; board: PostType; id: number; title: string }[];
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const d3 = (text: number, image: number | null) => {
  const s = [clamp01((text - B_TEXT) / (1 - B_TEXT)), ...(image === null ? [] : [clamp01((image - B_IMAGE) / (1 - B_IMAGE))])];
  return s.reduce((a, b) => a + b, 0) / s.length;
};
const r3 = (x: number) => +x.toFixed(3);
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.round(p * (s.length - 1))];
};
const dist = (xs: number[]) => ({ n: xs.length, min: r3(Math.min(...xs)), p25: r3(q(xs, 0.25)), p50: r3(q(xs, 0.5)), p75: r3(q(xs, 0.75)), max: r3(Math.max(...xs)) });
function metrics(ranks: (number | null)[]) {
  const n = ranks.length || 1;
  const at = (k: number) => r3(ranks.filter((r) => r !== null && r <= k).length / n);
  return { n: ranks.length, top1: at(1), recall3: at(3), recall5: at(5), mrr: r3(ranks.reduce<number>((s, r) => s + (r ? 1 / r : 0), 0) / n) };
}

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes(PREVIEW_REF)) throw new Error("Refusing to run: not the Preview DB.");
  const gt: GT = JSON.parse(await readFile(path.join(process.cwd(), "docs", "ai-eval-seed", "ground-truth.json"), "utf8"));

  // Same eligibility as findSimilarPosts: found 완료 / lost 찾음 are never candidates.
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT lp.id AS lost_id, fp.id AS found_id,
           1 - (lp.embedding <=> fp.embedding) AS text,
           CASE WHEN lp."imageEmbedding" IS NOT NULL AND fp."imageEmbedding" IS NOT NULL
                THEN 1 - (lp."imageEmbedding" <=> fp."imageEmbedding") END AS image,
           lp.status != '찾음'::"LostPostStatus" AS lost_ok,
           fp.status != '완료'::"FoundPostStatus" AS found_ok
    FROM "LostPost" lp CROSS JOIN "FoundPost" fp
    WHERE lp.embedding IS NOT NULL AND fp.embedding IS NOT NULL`;
  const pairs = rows.map((r) => ({ ...r, text: Number(r.text), image: r.image === null ? null : Number(r.image) }));
  const d3Of = (src: PostType, srcId: number, candId: number) => {
    const p = pairs.find((x) => (src === "lost" ? x.lost_id === srcId && x.found_id === candId : x.found_id === srcId && x.lost_id === candId))!;
    return d3(p.text, p.image);
  };
  const d3All = (src: PostType, srcId: number) =>
    pairs
      .filter((p) => (src === "lost" ? p.lost_id === srcId && p.found_ok : p.found_id === srcId && p.lost_ok))
      .map((p) => ({ id: src === "lost" ? p.found_id : p.lost_id, score: d3(p.text, p.image) }))
      .sort((a, b) => b.score - a.score || a.id - b.id);

  const methods = ["current", "d3_all", "d3_pool"] as const;
  type M = (typeof methods)[number];
  const rankRows: { method: M; direction: string; difficulty: string; rank: number | null; hnAbove: boolean | null }[] = [];
  const cases: Record<string, unknown>[] = [];

  const rankingsFor = async (src: PostType, id: number) => {
    const [t, i] = await Promise.all([findSimilarPosts(src, id, TOP_K).catch(() => []), findSimilarPostsByImage(src, id, TOP_K)]);
    const union = combineRankings(t, i);
    return {
      current: union.slice(0, TOP_K).map((r) => r.id),
      d3_all: d3All(src, id).slice(0, TOP_K).map((r) => r.id),
      d3_pool: union.map((r) => ({ id: r.id, s: d3Of(src, id, r.id) })).sort((a, b) => b.s - a.s || a.id - b.id).slice(0, TOP_K).map((r) => r.id),
    };
  };

  for (const p of gt.pairs) {
    for (const [direction, src, srcId, answerId, board] of [
      ["L→F", "lost", p.lost.id, p.found.id, "found"],
      ["F→L", "found", p.found.id, p.lost.id, "lost"],
    ] as const) {
      const negs = new Set(gt.hardNegatives.filter((n) => n.board === board && n.confusableWith.includes(p.pairId)).map((n) => n.id));
      const lists = await rankingsFor(src, srcId);
      const entry: Record<string, unknown> = { pairId: p.pairId, direction, difficulty: p.difficulty };
      for (const m of methods) {
        const idx = lists[m].indexOf(answerId);
        const rank = idx < 0 ? null : idx + 1;
        const above = rank === null ? lists[m] : lists[m].slice(0, rank - 1);
        rankRows.push({ method: m, direction, difficulty: p.difficulty, rank, hnAbove: negs.size ? above.some((x) => negs.has(x)) : null });
        entry[m] = rank;
      }
      entry.answerD3 = r3(d3Of(src, srcId, answerId));
      cases.push(entry);
    }
  }

  const noMatch = gt.noMatch.map((m) => {
    const best = d3All(m.board, m.id)[0];
    return { noMatchId: m.noMatchId, title: m.title, bestD3: r3(best.score) };
  });
  const answerD3 = cases.map((c) => c.answerD3 as number);

  const summarize = (filter: (r: (typeof rankRows)[number]) => boolean) =>
    Object.fromEntries(methods.map((m) => [m, metrics(rankRows.filter((r) => r.method === m && filter(r)).map((r) => r.rank))]));
  const hn = (m: M, dir?: string) => {
    const rs = rankRows.filter((r) => r.method === m && r.hnAbove !== null && (!dir || r.direction === dir));
    return `${rs.filter((r) => r.hnAbove).length}/${rs.length} = ${r3(rs.filter((r) => r.hnAbove).length / (rs.length || 1))}`;
  };

  const thresholdSweep = [0.2, 0.3, 0.35, 0.4, 0.45, 0.5].map((t) => ({
    threshold: t,
    noMatchSuppressed: `${noMatch.filter((m) => m.bestD3 < t).length}/10`,
    answersBelow: `${answerD3.filter((a) => a < t).length}/${answerD3.length}`,
  }));

  const changed = cases.filter((c) => c.current !== c.d3_all);
  const result = {
    environment: `Preview (${PREVIEW_REF})`,
    evaluatedAt: new Date().toISOString(),
    baselines: { b_text: B_TEXT, b_image: B_IMAGE },
    overall: summarize(() => true),
    byDirection: { "L→F": summarize((r) => r.direction === "L→F"), "F→L": summarize((r) => r.direction === "F→L") },
    byDifficulty: Object.fromEntries(["easy", "medium", "hard"].map((d) => [d, summarize((r) => r.difficulty === d)])),
    hardNegativeAbove: Object.fromEntries(methods.map((m) => [m, { all: hn(m), "L→F": hn(m, "L→F"), "F→L": hn(m, "F→L") }])),
    noMatchBestD3: { dist: dist(noMatch.map((m) => m.bestD3)), items: noMatch },
    answerD3: dist(answerD3),
    thresholdSweep,
    changedCases: changed,
    cases,
  };
  const out = path.join(process.cwd(), "docs", "ai-eval-seed", "d3-ranking-comparison-2026-09-29.json");
  await writeFile(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, cases: undefined }, null, 1));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
