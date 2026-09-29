// Renders batch-2 post images to <outDir>/<key>.jpg, the batch-2 image
// search query photos to docs/ai-eval-seed/query-images/, and a contact
// sheet (<outDir>/_sheet.jpg) for visual review. Rendering only.
// Run with: npx tsx scripts/ai-eval-seed/render-batch2-images.ts <outDir>
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { allJobs, NEW_QUERY_IMAGES } from "./data2";
import { renderJpeg } from "./images";

async function main() {
  const outDir = process.argv[2];
  if (!outDir) throw new Error("usage: render-batch2-images.ts <outDir>");
  await mkdir(outDir, { recursive: true });
  const queryDir = path.join(process.cwd(), "docs", "ai-eval-seed", "query-images");
  await mkdir(queryDir, { recursive: true });

  const tiles: Buffer[] = [];
  for (const job of allJobs()) {
    if (!job.spec.image) continue;
    const jpg = await renderJpeg(job.spec.image);
    await writeFile(path.join(outDir, `${job.key}.jpg`), jpg);
    tiles.push(jpg);
  }
  for (const [key, spec] of Object.entries(NEW_QUERY_IMAGES)) {
    const jpg = await renderJpeg(spec);
    await writeFile(path.join(queryDir, `${key}.jpg`), jpg);
    tiles.push(jpg);
  }

  const cols = 5;
  const tw = 288;
  const th = 216;
  const composites = await Promise.all(
    tiles.map(async (t, i) => ({ input: await sharp(t).resize(tw, th).toBuffer(), left: (i % cols) * tw, top: Math.floor(i / cols) * th })),
  );
  await sharp({ create: { width: cols * tw, height: Math.ceil(tiles.length / cols) * th, channels: 3, background: "#222" } })
    .composite(composites)
    .jpeg({ quality: 80 })
    .toFile(path.join(outDir, "_sheet.jpg"));
  console.log(`Rendered ${tiles.length - Object.keys(NEW_QUERY_IMAGES).length} post images + ${Object.keys(NEW_QUERY_IMAGES).length} query images`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
