// Renders the post images for EXTRA_SCENARIOS to <outDir>/<key>.jpg
// (key = "P05-lost", "N05", ...). Rendering only, no DB/Storage access.
// Run with: npx tsx scripts/ai-eval-seed/render-extra-images.ts <outDir>
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NEGATIVES, PAIRS } from "./data";
import { EXTRA_SCENARIOS } from "./extra-scenarios";
import { renderJpeg } from "./images";

async function main() {
  const outDir = process.argv[2];
  if (!outDir) throw new Error("usage: render-extra-images.ts <outDir>");
  await mkdir(outDir, { recursive: true });
  let count = 0;
  for (const s of EXTRA_SCENARIOS) {
    const pair = PAIRS.find((p) => p.pairId === s.pairId)!;
    const jobs = [
      { key: `${s.pairId}-lost`, spec: pair.lost.image },
      { key: `${s.pairId}-found`, spec: pair.found.image },
      ...s.negIds.map((id) => ({ key: id, spec: NEGATIVES.find((n) => n.negId === id)!.post.image })),
    ];
    for (const job of jobs) {
      if (!job.spec) continue;
      await writeFile(path.join(outDir, `${job.key}.jpg`), await renderJpeg(job.spec));
      count++;
    }
  }
  console.log(`Wrote ${count} images to ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
