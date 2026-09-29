// Read-only baseline evaluation over the fixed Preview benchmark
// (docs/ai-eval-seed/ground-truth.json). Never writes to the DB:
// recommendations come from computeRecommendationRanking() -- the exact
// ranking findPostRecommendations() serves, minus its MatchCandidateCache
// write. --legacy-fusion instead reproduces the pre-D3 in-pool min-max
// fusion (./legacyRankFusion.ts) the 2026-09-29 baseline was measured with.
// Semantic / image search call the real service functions; a second "raw"
// pass (pgvector top-K before the 0.65 threshold and the title bonus) is
// used only to attribute failures.
// Run with: npx tsx --env-file=.env.preview.local scripts/ai-eval-seed/evaluate.ts <out.json> [--legacy-fusion]
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db/prisma";
import { getEmbeddingProvider } from "@/lib/ai/embedding";
import { EmbeddingNotAvailableError, findPostsBySemanticQuery, findSimilarPosts, findSimilarPostsByImage } from "@/lib/ai/vectorSearch";
import { AI_SEARCH_MIN_SIMILARITY, searchPosts, searchPostsByImage } from "@/lib/posts/aiService";
import { computeRecommendationRanking } from "@/lib/recommendation/service";
import { combineRankings } from "./legacyRankFusion";
import type { PostType } from "@/lib/posts/schema";

const PREVIEW_REF = "swqvlihgupranzfzjevb";
const COLOR_WORDS = ["검은", "검정", "까만", "흰", "하얀", "화이트", "파란", "파랑", "빨간", "빨강", "붉은", "초록", "녹색", "회색", "그레이", "남색", "네이비", "분홍", "핑크", "베이지", "갈색", "브라운", "은색", "노란", "아이보리", "금색", "하늘색", "짙은"];

type GT = {
  pairs: { pairId: string; difficulty: "easy" | "medium" | "hard"; itemType: string; lost: { id: number; title: string }; found: { id: number; title: string; hasImage: boolean }; hardNegatives: string[]; results: { imageSearch: { queryImage: string } | null; semanticByDemoQuery: { query: string } | null } }[];
  hardNegatives: { negId: string; board: PostType; id: number; itemType: string; confusableWith: string[] }[];
  noMatch: { noMatchId: string; board: PostType; id: number; title: string; nearestTheme: string }[];
};

type Ranked = { id: number; score: number };
type PostInfo = { id: number; title: string; description: string; category: string; itemType: string; role: string };

const queryTokens = (q: string) => q.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2);
const colorsIn = (text: string) => COLOR_WORDS.filter((c) => text.includes(c));
const rankOf = (list: { id: number }[], id: number) => {
  const i = list.findIndex((r) => r.id === id);
  return i < 0 ? null : i + 1;
};

function metrics(ranks: (number | null)[]) {
  const n = ranks.length || 1;
  const at = (k: number) => ranks.filter((r) => r !== null && r <= k).length / n;
  return {
    n: ranks.length,
    top1: +at(1).toFixed(3),
    recall3: +at(3).toFixed(3),
    recall5: +at(5).toFixed(3),
    mrr: +(ranks.reduce<number>((s, r) => s + (r ? 1 / r : 0), 0) / n).toFixed(3),
  };
}

const LEGACY_FUSION = process.argv.includes("--legacy-fusion");

async function recommend(type: PostType, id: number): Promise<Ranked[]> {
  if (!LEGACY_FUSION) return computeRecommendationRanking(type, id);
  const [text, image] = await Promise.all([
    findSimilarPosts(type, id, 5).catch((e) => {
      if (e instanceof EmbeddingNotAvailableError) return [];
      throw e;
    }),
    findSimilarPostsByImage(type, id, 5),
  ]);
  return combineRankings(text, image).slice(0, 5).map((r) => ({ id: r.id, score: r.score }));
}

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes(PREVIEW_REF)) throw new Error("Refusing to run: not the Preview DB.");
  const gt: GT = JSON.parse(await readFile(path.join(process.cwd(), "docs", "ai-eval-seed", "ground-truth.json"), "utf8"));

  // id -> info, per board
  const info: Record<PostType, Map<number, PostInfo>> = { lost: new Map(), found: new Map() };
  const roleOf = new Map<string, string>();
  for (const p of gt.pairs) {
    roleOf.set(`lost:${p.lost.id}`, `answer:${p.pairId}:${p.itemType}`);
    roleOf.set(`found:${p.found.id}`, `answer:${p.pairId}:${p.itemType}`);
  }
  for (const n of gt.hardNegatives) roleOf.set(`${n.board}:${n.id}`, `hardneg:${n.negId}:${n.itemType}`);
  for (const m of gt.noMatch) roleOf.set(`${m.board}:${m.id}`, `nomatch:${m.noMatchId}:${m.nearestTheme}`);
  for (const board of ["lost", "found"] as const) {
    const rows = board === "lost" ? await prisma.lostPost.findMany() : await prisma.foundPost.findMany();
    for (const r of rows) {
      const role = roleOf.get(`${board}:${r.id}`) ?? "unknown";
      info[board].set(r.id, { id: r.id, title: r.title, description: r.description, category: r.category, itemType: role.split(":")[2] ?? "", role });
    }
  }
  const negIdsFor = (pairId: string, board: PostType) => new Set(gt.hardNegatives.filter((n) => n.board === board && n.confusableWith.includes(pairId)).map((n) => n.id));

  const embed = getEmbeddingProvider();
  const cases: Record<string, unknown>[] = [];
  const ranks: Record<string, { rank: number | null; difficulty: string }[]> = {
    semantic_title: [], semantic_fulltext: [], semantic_demo: [], rec_lost_to_found: [], rec_found_to_lost: [], image: [],
  };
  const failure = { titleBonus: 0, colorOverType: 0, categoryMismatch: 0, notInTopK: 0, thresholdRemovedAnswer: 0 };
  const failureExamples: Record<keyof typeof failure, string[]> = { titleBonus: [], colorOverType: [], categoryMismatch: [], notInTopK: [], thresholdRemovedAnswer: [] };
  const hardNegAbove: Record<string, { pairs: number; above: number }> = {};
  const threshold = { rawCandidates: 0, removed: 0, queriesFullyFiltered: 0, queries: 0 };

  const classify = (method: string, pairId: string, query: string, answer: PostInfo, list: { id: number }[], board: PostType) => {
    const aRank = rankOf(list, answer.id);
    const aboveIds = (aRank === null ? list : list.slice(0, aRank - 1)).map((r) => r.id);
    if (aboveIds.length === 0) return;
    const top = info[board].get(aboveIds[0])!;
    const qColors = colorsIn(query);
    if (top.itemType !== answer.itemType && colorsIn(`${top.title} ${top.description}`).some((c) => qColors.includes(c))) {
      failure.colorOverType++;
      if (failureExamples.colorOverType.length < 6) failureExamples.colorOverType.push(`[${method}] ${pairId} "${query}" → 1위 "${top.title}" (정답 "${answer.title}" ${aRank ?? "미포함"})`);
    }
    if (top.category !== answer.category) {
      failure.categoryMismatch++;
      if (failureExamples.categoryMismatch.length < 6) failureExamples.categoryMismatch.push(`[${method}] ${pairId} 1위 "${top.title}"(${top.category}) vs 정답 "${answer.title}"(${answer.category})`);
    }
  };

  for (const p of gt.pairs) {
    const lost = info.lost.get(p.lost.id)!;
    const found = info.found.get(p.found.id)!;
    const negsFound = negIdsFor(p.pairId, "found");
    const negsLost = negIdsFor(p.pairId, "lost");
    const record: Record<string, unknown> = { pairId: p.pairId, difficulty: p.difficulty, itemType: p.itemType };

    // ---- semantic search (lost's words -> 습득물 board) ----
    const semanticQueries: [string, string][] = [
      ["semantic_title", lost.title],
      ["semantic_fulltext", `${lost.title} ${lost.description}`.slice(0, 100)],
    ];
    if (p.results.semanticByDemoQuery) semanticQueries.push(["semantic_demo", p.results.semanticByDemoQuery.query]);
    for (const [method, q] of semanticQueries) {
      const res = await searchPosts({ type: "found", mode: "semantic", q, page: 1, limit: 10 });
      const final = res.items.map((r) => ({ id: r.id, score: r.score ?? 0 }));
      const rank = rankOf(final, found.id);
      ranks[method].push({ rank, difficulty: p.difficulty });

      const vector = await embed.embed(q);
      const rawAll = await findPostsBySemanticQuery("found", vector, 200);
      const rawTop10 = rawAll.slice(0, 10);
      const passed = rawTop10.filter((r) => r.score >= AI_SEARCH_MIN_SIMILARITY);
      threshold.queries++;
      threshold.rawCandidates += rawTop10.length;
      threshold.removed += rawTop10.length - passed.length;
      if (passed.length === 0) threshold.queriesFullyFiltered++;
      const trueRank = rankOf(rawAll, found.id);
      const answerRaw = rawAll.find((r) => r.id === found.id)?.score ?? null;
      const noBonus = [...passed].sort((a, b) => b.score - a.score || a.id - b.id);
      const rankNoBonus = rankOf(noBonus, found.id);

      if (rank === null) {
        if (trueRank !== null && trueRank <= 10 && (answerRaw ?? 0) < AI_SEARCH_MIN_SIMILARITY) {
          failure.thresholdRemovedAnswer++;
          if (failureExamples.thresholdRemovedAnswer.length < 6) failureExamples.thresholdRemovedAnswer.push(`[${method}] ${p.pairId} "${q}" 정답 raw ${answerRaw?.toFixed(3)} < 0.65`);
        } else {
          failure.notInTopK++;
          if (failureExamples.notInTopK.length < 8) failureExamples.notInTopK.push(`[${method}] ${p.pairId} "${q}" 정답 실제 순위 ${trueRank}위 (raw ${answerRaw?.toFixed(3)})`);
        }
      }
      if (rank !== null && rankNoBonus !== null && rank > rankNoBonus) {
        failure.titleBonus++;
        const toks = queryTokens(q);
        const jumped = final.slice(0, rank - 1).map((r) => info.found.get(r.id)!).filter((x) => toks.some((t) => x.title.includes(t)));
        if (failureExamples.titleBonus.length < 6) failureExamples.titleBonus.push(`[${method}] ${p.pairId} "${q}" 정답 ${rankNoBonus}위→${rank}위, 가산점 받은 "${jumped.map((j) => j.title).join('", "')}"`);
      }
      classify(method, p.pairId, q, found, final, "found");
      const key = `${method}`;
      hardNegAbove[key] ??= { pairs: 0, above: 0 };
      if (negsFound.size) {
        hardNegAbove[key].pairs++;
        const aboveList = rank === null ? final : final.slice(0, rank - 1);
        if (aboveList.some((r) => negsFound.has(r.id))) hardNegAbove[key].above++;
      }
      record[method] = { query: q, rank, rankWithoutTitleBonus: rankNoBonus, trueRankAllPosts: trueRank, answerRawScore: answerRaw, top3: final.slice(0, 3).map((r) => ({ ...r, title: info.found.get(r.id)!.title })) };
    }

    // ---- post-detail recommendation, both directions ----
    for (const [method, src, srcId, answer, negs, board] of [
      ["rec_lost_to_found", "lost", lost.id, found, negsFound, "found"],
      ["rec_found_to_lost", "found", found.id, lost, negsLost, "lost"],
    ] as const) {
      const recs = await recommend(src, srcId);
      const rank = rankOf(recs, answer.id);
      ranks[method].push({ rank, difficulty: p.difficulty });
      if (rank === null) {
        failure.notInTopK++;
        if (failureExamples.notInTopK.length < 8) failureExamples.notInTopK.push(`[${method}] ${p.pairId} "${src === "lost" ? lost.title : found.title}" → 정답 top5 밖, 1위 "${info[board].get(recs[0]?.id ?? -1)?.title}"`);
      }
      classify(method, p.pairId, `${info[src].get(srcId)!.title} ${info[src].get(srcId)!.description}`, answer, recs, board);
      hardNegAbove[method] ??= { pairs: 0, above: 0 };
      if (negs.size) {
        hardNegAbove[method].pairs++;
        const aboveList = rank === null ? recs : recs.slice(0, rank - 1);
        if (aboveList.some((r) => negs.has(r.id))) hardNegAbove[method].above++;
      }
      record[method] = { rank, top3: recs.slice(0, 3).map((r) => ({ ...r, title: info[board].get(r.id)!.title })) };
    }

    // ---- image search (unseen third view of the lost item -> 습득물 board) ----
    if (p.results.imageSearch && p.found.hasImage) {
      const jpg = await readFile(path.join(process.cwd(), "docs", "ai-eval-seed", "query-images", p.results.imageSearch.queryImage));
      const res = await searchPostsByImage("found", new Blob([new Uint8Array(jpg)], { type: "image/jpeg" }), { page: 1, limit: 10 });
      const list = res.items.map((r) => ({ id: r.id, score: r.score ?? 0 }));
      const rank = rankOf(list, found.id);
      ranks.image.push({ rank, difficulty: p.difficulty });
      hardNegAbove.image ??= { pairs: 0, above: 0 };
      if (negsFound.size) {
        hardNegAbove.image.pairs++;
        const aboveList = rank === null ? list : list.slice(0, rank - 1);
        if (aboveList.some((r) => negsFound.has(r.id))) hardNegAbove.image.above++;
      }
      record.image = { queryImage: p.results.imageSearch.queryImage, rank, resultCount: list.length, top3: list.slice(0, 3).map((r) => ({ ...r, title: info.found.get(r.id)!.title })) };
    }
    cases.push(record);
    console.log(`${p.pairId} done`);
  }

  // ---- no-match ----
  const noMatch = [];
  for (const m of gt.noMatch) {
    const other: PostType = m.board === "lost" ? "found" : "lost";
    const recs = await recommend(m.board, m.id);
    const rawText = await findSimilarPosts(m.board, m.id, 1).catch(() => []);
    const sem = await searchPosts({ type: other, mode: "semantic", q: m.title, page: 1, limit: 10 });
    noMatch.push({
      noMatchId: m.noMatchId, title: m.title, board: m.board,
      recommendation: { shown: recs.length, top1: recs[0] ? { title: info[other].get(recs[0].id)!.title, displayedScore: recs[0].score, rawTextSimilarity: rawText[0]?.score ?? null } : null },
      semantic: { shown: sem.items.length, top1: sem.items[0] ? { title: sem.items[0].title, score: sem.items[0].score } : null },
    });
  }
  const recTop1Display = cases.map((c) => (c.rec_lost_to_found as { top3: Ranked[] }).top3[0]?.score).filter((s): s is number => s !== undefined);

  const byDifficulty = (method: string) =>
    Object.fromEntries((["easy", "medium", "hard"] as const).map((d) => [d, metrics(ranks[method].filter((r) => r.difficulty === d).map((r) => r.rank))]));
  const allSearchLike = ["semantic_title", "rec_lost_to_found", "image"].flatMap((m) => ranks[m].map((r) => r.rank));

  const baseline = {
    environment: `Preview (${PREVIEW_REF})`,
    evaluatedAt: new Date().toISOString(),
    benchmark: "docs/ai-eval-seed/ground-truth.json (26 pairs, 37 hard negatives, 10 no-match, 99 posts)",
    notes: [
      "알고리즘/점수 계산 미수정 상태의 baseline.",
      "추천은 findPostRecommendations()와 동일한 함수 조합으로 계산(캐시 미기록).",
      "semantic_title=분실글 제목, semantic_fulltext=분실글 제목+본문(100자 제한), semantic_demo=시연용 자연어 문장(일부 쌍만).",
      "image=같은 물건을 다른 각도/배경으로 그린 합성 이미지(실사진 아님), 사진 있는 12쌍만.",
    ],
    overall_primary: metrics(allSearchLike),
    byMethod: Object.fromEntries(Object.keys(ranks).map((m) => [m, metrics(ranks[m].map((r) => r.rank))])),
    byDifficulty: Object.fromEntries(Object.keys(ranks).map((m) => [m, byDifficulty(m)])),
    hardNegativeAboveAnswerRate: Object.fromEntries(Object.entries(hardNegAbove).map(([k, v]) => [k, { ...v, rate: +(v.above / (v.pairs || 1)).toFixed(3) }])),
    noMatch: {
      recommendationShownRate: noMatch.filter((m) => m.recommendation.shown > 0).length / noMatch.length,
      recommendationTop1DisplayedAs1: noMatch.filter((m) => m.recommendation.top1?.displayedScore === 1).length / noMatch.length,
      semanticShownRate: noMatch.filter((m) => m.semantic.shown > 0).length / noMatch.length,
      semanticAvgShown: noMatch.reduce((s, m) => s + m.semantic.shown, 0) / noMatch.length,
      items: noMatch,
    },
    relativeScore: { pairsWhereRecTop1Displayed1000: recTop1Display.filter((s) => s === 1).length, pairs: recTop1Display.length },
    threshold: { ...threshold, removedRate: +(threshold.removed / (threshold.rawCandidates || 1)).toFixed(3) },
    failureCounts: failure,
    failureExamples,
    cases,
  };
  const outArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!outArg) throw new Error("usage: evaluate.ts <out.json> [--legacy-fusion]");
  const out = path.resolve(outArg);
  await writeFile(out, JSON.stringify(baseline, null, 2));
  console.log(JSON.stringify({ overall: baseline.overall_primary, byMethod: baseline.byMethod, byDifficulty: baseline.byDifficulty, hardNeg: baseline.hardNegativeAboveAnswerRate, noMatch: { ...baseline.noMatch, items: undefined }, relativeScore: baseline.relativeScore, threshold: baseline.threshold, failure, failureExamples }, null, 1));
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
