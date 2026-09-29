// Read-only: recomputes the D3 baselines (b_text, b_image) with the same
// definition rankFusion.ts documents -- the median cosine over every
// non-answer lost x found pair, per signal -- on the current Preview
// benchmark, for all posts and for the original 99 only, and compares them
// with the constants in use. Changes nothing (constants included).
// Run with: npx tsx --env-file=.env.preview.local scripts/ai-eval-seed/compute-d3-baselines.ts
import { readFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db/prisma";
import { AI_SIMILARITY_IMAGE_BASELINE, AI_SIMILARITY_TEXT_BASELINE } from "@/lib/ai/rankFusion";

const PREVIEW_REF = "swqvlihgupranzfzjevb";
type Row = { lost_id: number; found_id: number; text: number; image: number | null };

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.round(p * (s.length - 1))];
};
const r3 = (x: number) => +x.toFixed(3);
const stats = (xs: number[]) => ({ n: xs.length, p25: r3(q(xs, 0.25)), p50: r3(q(xs, 0.5)), p75: r3(q(xs, 0.75)) });

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes(PREVIEW_REF)) throw new Error("Refusing to run: not the Preview DB.");
  const gt = JSON.parse(await readFile(path.join(process.cwd(), "docs", "ai-eval-seed", "ground-truth.json"), "utf8"));
  const answers = new Set(gt.pairs.map((p: { lost: { id: number }; found: { id: number } }) => `${p.lost.id}-${p.found.id}`));
  const batchOf = new Map<string, string>(gt.posts.map((p: { board: string; id: number; batch: string }) => [`${p.board}:${p.id}`, p.batch]));
  const isOriginal = (board: string, id: number) => batchOf.get(`${board}:${id}`) !== "batch3";

  const rows = (
    await prisma.$queryRaw<Row[]>`
      SELECT lp.id AS lost_id, fp.id AS found_id,
             1 - (lp.embedding <=> fp.embedding) AS text,
             CASE WHEN lp."imageEmbedding" IS NOT NULL AND fp."imageEmbedding" IS NOT NULL
                  THEN 1 - (lp."imageEmbedding" <=> fp."imageEmbedding") END AS image
      FROM "LostPost" lp CROSS JOIN "FoundPost" fp
      WHERE lp.embedding IS NOT NULL AND fp.embedding IS NOT NULL`
  ).map((r) => ({ ...r, text: Number(r.text), image: r.image === null ? null : Number(r.image) }));

  const report = (label: string, subset: typeof rows) => {
    const bg = subset.filter((r) => !answers.has(`${r.lost_id}-${r.found_id}`));
    const ans = subset.filter((r) => answers.has(`${r.lost_id}-${r.found_id}`));
    const bgImage = bg.filter((r) => r.image !== null).map((r) => r.image!);
    const ansImage = ans.filter((r) => r.image !== null).map((r) => r.image!);
    const t = q(bg.map((r) => r.text), 0.5);
    const i = q(bgImage, 0.5);
    console.log(`\n== ${label} ==`);
    console.log(`b_text  = ${r3(t)} (current ${AI_SIMILARITY_TEXT_BASELINE}, diff ${t - AI_SIMILARITY_TEXT_BASELINE >= 0 ? "+" : ""}${r3(t - AI_SIMILARITY_TEXT_BASELINE)})  background ${JSON.stringify(stats(bg.map((r) => r.text)))}  answers ${JSON.stringify(stats(ans.map((r) => r.text)))}`);
    console.log(`b_image = ${r3(i)} (current ${AI_SIMILARITY_IMAGE_BASELINE}, diff ${i - AI_SIMILARITY_IMAGE_BASELINE >= 0 ? "+" : ""}${r3(i - AI_SIMILARITY_IMAGE_BASELINE)})  background ${JSON.stringify(stats(bgImage))}  answers ${JSON.stringify(stats(ansImage))}`);
    // Effect on a typical answer's displayed text AI 유사도 if the constant moved.
    const med = q(ans.map((r) => r.text), 0.5);
    const d3 = (c: number, b: number) => Math.max(0, Math.min(1, (c - b) / (1 - b)));
    console.log(`median answer text cos ${r3(med)}: D3 with current b ${r3(d3(med, AI_SIMILARITY_TEXT_BASELINE))} vs recomputed b ${r3(d3(med, t))}`);
  };

  report("original 99 posts only", rows.filter((r) => isOriginal("lost", r.lost_id) && isOriginal("found", r.found_id)));
  report(`all ${gt.summary.total} posts`, rows);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
