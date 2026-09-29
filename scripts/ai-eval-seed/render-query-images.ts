// Writes the demo image-search query photos (an unseen third view of each
// lost item) to docs/ai-eval-seed/query-images/. Rendering only -- kept in
// its own process because loading sharp alongside @huggingface/transformers
// in one process breaks the image-embedding step.
// Run with: npx tsx scripts/ai-eval-seed/render-query-images.ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEMOS } from "./data";
import { renderJpeg } from "./images";

async function main() {
  const outDir = path.join(process.cwd(), "docs", "ai-eval-seed", "query-images");
  await mkdir(outDir, { recursive: true });
  for (const demo of DEMOS) {
    await writeFile(path.join(outDir, `${demo.demoId}.jpg`), await renderJpeg(demo.queryImage));
  }
  console.log(`Wrote ${DEMOS.length} query images to ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
