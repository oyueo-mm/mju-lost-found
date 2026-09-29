// Ground-truth-only update (no DB access): records the earphone-family posts
// added in batch 3 that now outrank P09's answer (measured 2026-09-29 with
// the D3 recommendation and AI 검색 on the 249-post Preview benchmark):
//   - G06 "무선 이어폰 한쪽 (흰색)"   (hard negative)   -> above the answer in title search
//   - R04-found "검은 이어폰 한 쪽 (유닛만)" (R04 answer) -> above it in rec L→F and title search
//   - R03-lost "줄 이어폰 분실 (C타입)"      (R03 answer) -> above it in rec F→L
// A hard negative gets P09 added to its confusableWith (and P09's
// hardNegatives); a post that is itself another pair's answer can't be a
// negId, so it goes into P09's crossPairConfusers and its posts[] entry's
// alsoConfusableWith. Idempotent.
// Run with: npx tsx scripts/ai-eval-seed/annotate-p09-confusers.ts
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Board = "lost" | "found";
type IndexedPost = { board: Board; id: number; title: string; hasImage: boolean; role: string; pairId?: string; negId?: string; confusableWith?: string[]; alsoConfusableWith?: string[] };

const PAIR_ID = "P09";
const HARD_NEGATIVES = ["G06"];
const CROSS_PAIR: { pairId: string; board: Board; reason: string }[] = [
  { pairId: "R04", board: "found", reason: "검은 무선 이어폰 한 쪽 습득(소니) -- 짙은 회색 버즈 한 쪽과 같은 '이어폰 한 쪽' 계열, 추천 분실→습득·제목 검색에서 P09 정답보다 위" },
  { pairId: "R03", board: "lost", reason: "유선 이어폰 분실(같은 제2공학관) -- 이어폰 계열, 추천 습득→분실에서 P09 정답보다 위" },
];

async function main() {
  const file = path.join(process.cwd(), "docs", "ai-eval-seed", "ground-truth.json");
  const gt = JSON.parse(await readFile(file, "utf8"));
  const pair = gt.pairs.find((p: { pairId: string }) => p.pairId === PAIR_ID);
  if (!pair) throw new Error(`${PAIR_ID} not found`);
  const posts: IndexedPost[] = gt.posts;

  for (const negId of HARD_NEGATIVES) {
    const neg = gt.hardNegatives.find((n: { negId: string }) => n.negId === negId);
    if (!neg) throw new Error(`${negId} not found`);
    if (!neg.confusableWith.includes(PAIR_ID)) neg.confusableWith.push(PAIR_ID);
    if (!pair.hardNegatives.includes(negId)) pair.hardNegatives.push(negId);
    const indexed = posts.find((p) => p.negId === negId);
    if (indexed && !indexed.confusableWith!.includes(PAIR_ID)) indexed.confusableWith!.push(PAIR_ID);
  }

  pair.crossPairConfusers ??= [];
  for (const c of CROSS_PAIR) {
    const other = gt.pairs.find((p: { pairId: string }) => p.pairId === c.pairId);
    const side = other[c.board] as { id: number; title: string; hasImage: boolean };
    if (!pair.crossPairConfusers.some((x: { board: Board; id: number }) => x.board === c.board && x.id === side.id)) {
      pair.crossPairConfusers.push({ board: c.board, id: side.id, title: side.title, hasImage: side.hasImage, answerOf: c.pairId, reason: c.reason });
    }
    const indexed = posts.find((p) => p.board === c.board && p.id === side.id);
    if (!indexed) throw new Error(`${c.board}:${side.id} not in posts[]`);
    indexed.alsoConfusableWith ??= [];
    if (!indexed.alsoConfusableWith.includes(PAIR_ID)) indexed.alsoConfusableWith.push(PAIR_ID);
  }

  await writeFile(file, JSON.stringify(gt, null, 2));
  console.log(JSON.stringify({ hardNegatives: pair.hardNegatives, crossPairConfusers: pair.crossPairConfusers }, null, 1));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
