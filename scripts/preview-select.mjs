#!/usr/bin/env node
// Local-only component preview. Does not read .env, call APIs, or use a DB.
// npm run build (once), then node scripts/preview-select.mjs
import { build } from "rolldown";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const chunks = path.join(root, ".next/static/chunks");
let css;
try {
  css = readdirSync(chunks).filter((name) => name.endsWith(".css")).map((name) => readFileSync(path.join(chunks, name), "utf8")).join("\n");
} catch {
  console.error("Run npm run build before starting the select preview.");
  process.exit(1);
}
const outputDir = path.join(root, ".next/select-preview");
mkdirSync(outputDir, { recursive: true });
await build({
  input: path.join(root, "scripts/fixtures/SelectPreview.tsx"),
  resolve: { alias: { "@": path.join(root, "src"), "next/navigation": path.join(root, "scripts/fixtures/selectNavigation.ts") } },
  transform: { jsx: { runtime: "automatic" }, define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } },
  output: { file: path.join(outputDir, "preview.js"), format: "iife" },
});
const server = createServer((request, response) => {
  if (request.method !== "GET" || request.url?.startsWith("/api/")) {
    response.writeHead(405).end("Local UI preview: no API requests");
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/preview.js") {
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(readFileSync(path.join(outputDir, "preview.js")));
    return;
  }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MJU Find 선택 UI 로컬 미리보기</title><style>${css}</style><div id="root"></div><script src="/preview.js"></script></html>`);
});
server.listen(4199, "127.0.0.1", () => console.log("Select preview: http://127.0.0.1:4199/?mode=keyword&q=wallet&period=1w"));
