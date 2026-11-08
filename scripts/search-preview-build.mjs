import { build } from "rolldown";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

export async function loadSearchPreviewBackend() {
  const root = process.cwd();
  const folder = path.join(root, ".vercel/unified-search-preview");
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, "backend.mjs");
  await build({
    input: path.join(root, "scripts/fixtures/searchPreviewBackend.ts"),
    platform: "node",
    external: ["@huggingface/transformers"],
    resolve: { alias: { "@": path.join(root, "src") } },
    plugins: [{ name: "read-only-preview-adapters", resolveId(source, importer) {
      if (source === "@/lib/metrics/record") return path.join(root, "scripts/fixtures/searchPreviewMetrics.ts");
      if (importer?.replaceAll("\\", "/").endsWith("/src/lib/posts/unifiedSearch.ts") && (source === "./service" || source === "./aiService")) return path.join(root, "scripts/fixtures/searchPreviewRetrievers.ts");
    } }],
    output: { file, format: "es" },
  });
  return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}
