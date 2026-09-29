// Read-only analysis for a search-specific AI 유사도 calibration. Changes no
// app code, no constants, no data.
//   1. Query <-> post cosine distributions: every post's title (and
//      title+description, first 100 chars -- the same query evaluate uses)
//      embedded as a search query against every opposite-board post.
//      "Unrelated" = not the ground-truth answer. Median -> b_text_search.
//   2. What search AI 유사도 would look like with that baseline (answers vs.
//      no-match top-1, threshold sweep), vs. the current post<->post b_text.
//   3. Title-bonus simulation: the app's semantic ranking (top 10 by cosine,
//      normalized >= 0.65, then sorted by normalized + bonus) for several
//      bonus sizes -- ranking metrics and how often the displayed AI 유사도
//      is not monotonic with the order.
// The simulation is validated against the app's own searchPostsAI() numbers
// in baseline-d3-249-2026-09-29.json (printed side by side).
// Run with: npx tsx --env-file=.env.preview.local scripts/ai-eval-seed/analyze-search-calibration.ts
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db/prisma";
import { getEmbeddingProvider } from "@/lib/ai/embedding";
import { AI_SIMILARITY_TEXT_BASELINE } from "@/lib/ai/rankFusion";
import { AI_SEARCH_MIN_SIMILARITY } from "@/lib/posts/aiService";

const PREVIEW_REF = "swqvlihgupranzfzjevb";
const TOP_K = 10; // aiService.ts SEMANTIC_SEARCH_TOP_K
const CURRENT_BONUS = 0.03; // aiService.ts LEXICAL_TITLE_MATCH_BONUS
const BONUSES = [0.03, 0.02, 0.01, 0.005, 0];
const THRESHOLDS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4];

type Post = { board: "lost" | "found"; id: number; title: string; description: string; vec: number[] };
const r3 = (x: number) => +x.toFixed(3);
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.round(p * (s.length - 1))];
};
const dist = (xs: number[]) => ({ n: xs.length, p10: r3(q(xs, 0.1)), p25: r3(q(xs, 0.25)), p50: r3(q(xs, 0.5)), p75: r3(q(xs, 0.75)), p90: r3(q(xs, 0.9)) });
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0); // vectors are L2-normalized
const tokens = (qs: string) => qs.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2);
const d3 = (cos: number, b: number) => Math.max(0, Math.min(1, (cos - b) / (1 - b)));
const auc = (pos: number[], neg: number[]) => {
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return r3(s / (pos.length * neg.length || 1));
};
function metrics(ranks: (number | null)[]) {
  const n = ranks.length || 1;
  const at = (k: number) => r3(ranks.filter((r) => r !== null && r <= k).length / n);
  return { n: ranks.length, top1: at(1), recall3: at(3), recall5: at(5), mrr: r3(ranks.reduce<number>((s, r) => s + (r ? 1 / r : 0), 0) / n) };
}

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes(PREVIEW_REF)) throw new Error("Refusing to run: not the Preview DB.");
  const gt = JSON.parse(await readFile(path.join(process.cwd(), "docs", "ai-eval-seed", "ground-truth.json"), "utf8"));
  const baseline = JSON.parse(await readFile(path.join(process.cwd(), "docs", "ai-eval-seed", "baseline-d3-249-2026-09-29.json"), "utf8"));

  const load = async (board: "lost" | "found") => {
    const rows = board === "lost"
      ? await prisma.$queryRaw<{ id: number; title: string; description: string; e: string }[]>`SELECT id, title, description, embedding::text AS e FROM "LostPost" WHERE embedding IS NOT NULL`
      : await prisma.$queryRaw<{ id: number; title: string; description: string; e: string }[]>`SELECT id, title, description, embedding::text AS e FROM "FoundPost" WHERE embedding IS NOT NULL`;
    return rows.map((r) => ({ board, id: r.id, title: r.title, description: r.description, vec: JSON.parse(r.e) as number[] }));
  };
  const posts: Record<"lost" | "found", Post[]> = { lost: await load("lost"), found: await load("found") };
  const answerOf = new Map<string, number>();
  for (const p of gt.pairs) {
    answerOf.set(`lost:${p.lost.id}`, p.found.id);
    answerOf.set(`found:${p.found.id}`, p.lost.id);
  }
  const embed = getEmbeddingProvider();

  // ---------- 1. query <-> post distributions ----------
  type Q = { src: Post; kind: "title" | "fulltext"; text: string; cos: { id: number; cos: number }[] };
  const queries: Q[] = [];
  for (const board of ["lost", "found"] as const) {
    const other = board === "lost" ? "found" : "lost";
    for (const p of posts[board]) {
      for (const kind of ["title", "fulltext"] as const) {
        const text = kind === "title" ? p.title : `${p.title} ${p.description}`.slice(0, 100);
        const v = await embed.embed(text);
        queries.push({ src: p, kind, text, cos: posts[other].map((c) => ({ id: c.id, cos: dot(v, c.vec) })) });
      }
    }
  }
  console.log(`embedded ${queries.length} queries`);

  const distributions: Record<string, unknown> = {};
  const searchBaseline: Record<string, number> = {};
  for (const kind of ["title", "fulltext"] as const) {
    const qs = queries.filter((x) => x.kind === kind);
    const unrelated = qs.flatMap((x) => x.cos.filter((c) => c.id !== answerOf.get(`${x.src.board}:${x.src.id}`)).map((c) => c.cos));
    const answers = qs.flatMap((x) => {
      const a = answerOf.get(`${x.src.board}:${x.src.id}`);
      return a === undefined ? [] : x.cos.filter((c) => c.id === a).map((c) => c.cos);
    });
    searchBaseline[kind] = q(unrelated, 0.5);
    distributions[kind] = { unrelated: dist(unrelated), answers: dist(answers) };
  }

  // ---------- 2. search AI 유사도 with each baseline ----------
  const shownList = (x: Q) => [...x.cos].sort((a, b) => b.cos - a.cos || a.id - b.id).slice(0, TOP_K).filter((c) => (c.cos + 1) / 2 >= AI_SEARCH_MIN_SIMILARITY);
  const noMatchKeys = new Set(gt.noMatch.map((m: { board: string; id: number }) => `${m.board}:${m.id}`));
  const scaleReport: Record<string, unknown> = {};
  for (const kind of ["title", "fulltext"] as const) {
    const qs = queries.filter((x) => x.kind === kind);
    const pairQs = qs.filter((x) => answerOf.has(`${x.src.board}:${x.src.id}`));
    const nmQs = qs.filter((x) => noMatchKeys.has(`${x.src.board}:${x.src.id}`));
    for (const [label, b] of [["post-post b_text (current)", AI_SIMILARITY_TEXT_BASELINE], [`search b_text_search (${kind})`, searchBaseline[kind]]] as const) {
      const answerD3 = pairQs.map((x) => d3(x.cos.find((c) => c.id === answerOf.get(`${x.src.board}:${x.src.id}`))!.cos, b));
      const nmTop1 = nmQs.map((x) => d3(shownList(x)[0]?.cos ?? -1, b));
      const sweep = THRESHOLDS.map((t) => {
        const answerInList = pairQs.filter((x) => shownList(x).some((c) => c.id === answerOf.get(`${x.src.board}:${x.src.id}`)));
        const kept = answerInList.filter((x) => d3(x.cos.find((c) => c.id === answerOf.get(`${x.src.board}:${x.src.id}`))!.cos, b) >= t);
        return {
          threshold: t,
          noMatchSuppressed: r3(nmQs.filter((x) => !shownList(x).some((c) => d3(c.cos, b) >= t)).length / nmQs.length),
          answersDropped: r3((answerInList.length - kept.length) / (answerInList.length || 1)),
          recall: r3(kept.length / pairQs.length),
        };
      });
      scaleReport[`${kind} | ${label}`] = { baseline: r3(b), answerD3: dist(answerD3), noMatchTop1D3: dist(nmTop1), auc: auc(answerD3, nmTop1), sweep };
    }
  }

  // ---------- 3. title bonus simulation (lost title / fulltext -> found board, the benchmark queries) ----------
  const foundTitle = new Map(posts.found.map((p) => [p.id, p.title]));
  const negs = (pairId: string) => new Set<number>(gt.hardNegatives.filter((n: { board: string; confusableWith: string[] }) => n.board === "found" && n.confusableWith.includes(pairId)).map((n: { id: number }) => n.id));
  const bonusReport: Record<string, unknown> = {};
  for (const kind of ["title", "fulltext"] as const) {
    for (const bonus of BONUSES) {
      const ranks: (number | null)[] = [];
      let invertedLists = 0;
      let hnPairs = 0;
      let hnAbove = 0;
      for (const p of gt.pairs) {
        const x = queries.find((y) => y.kind === kind && y.src.board === "lost" && y.src.id === p.lost.id)!;
        const toks = tokens(x.text);
        const list = shownList(x)
          .map((c) => ({ ...c, rankScore: Math.min(1, (c.cos + 1) / 2 + (toks.some((t) => foundTitle.get(c.id)!.includes(t)) ? bonus : 0)) }))
          .sort((a, b) => b.rankScore - a.rankScore || a.id - b.id);
        const i = list.findIndex((c) => c.id === p.found.id);
        ranks.push(i < 0 ? null : i + 1);
        if (list.some((c, k) => k > 0 && c.cos > list[k - 1].cos + 1e-9)) invertedLists++;
        const n = negs(p.pairId);
        if (n.size) {
          hnPairs++;
          if ((i < 0 ? list : list.slice(0, i)).some((c) => n.has(c.id))) hnAbove++;
        }
      }
      bonusReport[`${kind} bonus=${bonus}`] = { ...metrics(ranks), listsWithDisplayInversion: `${invertedLists}/${gt.pairs.length}`, hardNegativeAbove: `${hnAbove}/${hnPairs}` };
    }
  }
  const validation = {
    title: { simulated: bonusReport[`title bonus=${CURRENT_BONUS}`], app: baseline.overall.semantic_title },
    fulltext: { simulated: bonusReport[`fulltext bonus=${CURRENT_BONUS}`], app: baseline.overall.semantic_fulltext },
  };

  const result = { environment: `Preview (${PREVIEW_REF})`, evaluatedAt: new Date().toISOString(), searchBaseline: Object.fromEntries(Object.entries(searchBaseline).map(([k, v]) => [k, r3(v)])), distributions, scaleReport, bonusReport, validation };
  const out = path.join(process.cwd(), "docs", "ai-eval-seed", "search-calibration-2026-09-29.json");
  await writeFile(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 1));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
