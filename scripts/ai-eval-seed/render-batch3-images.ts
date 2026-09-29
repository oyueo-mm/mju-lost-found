// Renders batch-3 post images to <outDir>/<key>.jpg, the batch-3 image
// search query photos to docs/ai-eval-seed/query-images/, and a contact
// sheet (<outDir>/_sheet.jpg) for visual review. Also validates the batch
// (counts, unique titles vs. the existing benchmark, categories, locations)
// before anything is rendered. Rendering only -- no DB or Storage access.
// Run with: npx tsx scripts/ai-eval-seed/render-batch3-images.ts <outDir>
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { CAMPUS_LOCATIONS } from "@/lib/posts/campusLocations";
import { CATEGORIES } from "@/lib/posts/schema";

import { allJobs3, NEGATIVES3, NO_MATCH3, PAIRS3, QUERY_IMAGES3 } from "./data3";
import { renderJpeg } from "./images";

async function validate() {
  const gt = JSON.parse(await readFile(path.join(process.cwd(), "docs", "ai-eval-seed", "ground-truth.json"), "utf8"));
  const existing = new Set<string>([
    ...gt.pairs.flatMap((p: { lost: { title: string }; found: { title: string } }) => [p.lost.title, p.found.title]),
    ...gt.hardNegatives.map((n: { title: string }) => n.title),
    ...gt.noMatch.map((m: { title: string }) => m.title),
  ]);
  const jobs = allJobs3();
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const j of jobs) {
    if (existing.has(j.spec.title) || seen.has(j.spec.title)) problems.push(`duplicate title: ${j.key} "${j.spec.title}"`);
    seen.add(j.spec.title);
    if (!(CATEGORIES as readonly string[]).includes(j.spec.category)) problems.push(`bad category: ${j.key} ${j.spec.category}`);
    if (j.spec.location && !CAMPUS_LOCATIONS[j.spec.campus].includes(j.spec.location)) problems.push(`bad location: ${j.key} ${j.spec.campus} ${j.spec.location}`);
  }
  const pairIds = new Set([...PAIRS3.map((p) => p.pairId), ...gt.pairs.map((p: { pairId: string }) => p.pairId)]);
  for (const n of NEGATIVES3) for (const c of n.confusableWith) if (!pairIds.has(c)) problems.push(`unknown pair ${c} in ${n.negId}`);
  for (const p of PAIRS3) for (const t of p.existingConfusers ?? []) if (!existing.has(t)) problems.push(`unknown existing confuser "${t}" in ${p.pairId}`);
  if (problems.length) throw new Error(problems.join("\n"));

  const images = jobs.filter((j) => j.spec.image).length;
  const total = gt.summary.total + jobs.length;
  const totalImages = gt.summary.withImage + images;
  console.log(
    `batch3: pairs ${PAIRS3.length}, negatives ${NEGATIVES3.length}, no-match ${NO_MATCH3.length}, posts ${jobs.length}, images ${images}` +
      ` | after: ${total} posts, ${totalImages} images (${((totalImages / total) * 100).toFixed(1)}%)`,
  );
}

async function main() {
  const outDir = process.argv[2];
  if (!outDir) throw new Error("usage: render-batch3-images.ts <outDir>");
  await validate();
  await mkdir(outDir, { recursive: true });
  const queryDir = path.join(process.cwd(), "docs", "ai-eval-seed", "query-images");
  await mkdir(queryDir, { recursive: true });

  const tiles: Buffer[] = [];
  for (const job of allJobs3()) {
    if (!job.spec.image) continue;
    const jpg = await renderJpeg(job.spec.image);
    await writeFile(path.join(outDir, `${job.key}.jpg`), jpg);
    tiles.push(jpg);
  }
  for (const [key, spec] of Object.entries(QUERY_IMAGES3)) {
    const jpg = await renderJpeg(spec);
    await writeFile(path.join(queryDir, `${key}.jpg`), jpg);
    tiles.push(jpg);
  }

  const cols = 8;
  const tw = 240;
  const th = 180;
  const composites = await Promise.all(
    tiles.map(async (t, i) => ({ input: await sharp(t).resize(tw, th).toBuffer(), left: (i % cols) * tw, top: Math.floor(i / cols) * th })),
  );
  await sharp({ create: { width: cols * tw, height: Math.ceil(tiles.length / cols) * th, channels: 3, background: "#222" } })
    .composite(composites)
    .jpeg({ quality: 80 })
    .toFile(path.join(outDir, "_sheet.jpg"));
  const bytes = (await Promise.all(tiles.map((t) => t.length))).reduce((a, b) => a + b, 0);
  console.log(`Rendered ${tiles.length - Object.keys(QUERY_IMAGES3).length} post images + ${Object.keys(QUERY_IMAGES3).length} query images (${(bytes / 1024 / 1024).toFixed(1)} MB total)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
