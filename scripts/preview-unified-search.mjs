#!/usr/bin/env node
// Real UI + unified orchestrator/models over a verified synthetic snapshot.
// No DB connection, environment file read, metrics writes, or remote models.
import { createServer } from "node:http";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { build } from "rolldown";
import path from "node:path";
import postcss from "postcss";
import { loadSearchPreviewBackend } from "./search-preview-build.mjs";

const root = process.cwd();
const backend = await loadSearchPreviewBackend();
const homeRecommendations = (await backend.searchPosts({ type: "found", page: 1, limit: 6 })).items;
const output = ".vercel/unified-search-preview";
mkdirSync(output, { recursive: true });
const cssTree = postcss.parse(readdirSync(".next/static/chunks").filter((file) => file.endsWith(".css")).map((file) => readFileSync(`.next/static/chunks/${file}`, "utf8")).join("\n"));
cssTree.walkRules((rule) => { if (rule.selector.includes("select.mju-select")) rule.remove(); });
const css = cssTree.toString() + readFileSync("src/components/ui/select.css", "utf8");
await build({
  input: path.join(root, "scripts/fixtures/UnifiedSearchPreview.tsx"),
  resolve: { alias: { "@": path.join(root, "src"), "next/navigation": path.join(root, "scripts/fixtures/searchPreviewNavigation.ts"), "next/link": path.join(root, "scripts/fixtures/searchPreviewLink.tsx") } },
  transform: { jsx: { runtime: "automatic" }, define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } },
  output: { file: path.join(root, output, "client.js"), format: "iife" },
});
const json = (response, status, body) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
const envelope = (result) => ({ data: result.items, pagination: { page: result.page, limit: result.limit, total: result.total, totalPages: result.totalPages }, ...(result.search && { search: result.search }) });
createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:4210");
  response.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/api/posts") {
    try {
      if (request.method !== "GET" && request.method !== "POST") return json(response, 405, { error: "Read-only local preview" });
      let q = url.searchParams.get("q") ?? undefined;
      let image;
      if (request.method === "POST") {
        if (!["ai", "image"].includes(url.searchParams.get("mode"))) return json(response, 405, { error: "Post creation is disabled in the preview" });
        const buffers = [];
        let size = 0;
        for await (const buffer of request) { size += buffer.length; if (size > 11 * 1024 * 1024) return json(response, 413, { error: "File too large" }); buffers.push(buffer); }
        const incoming = new Request(url, { method: "POST", headers: request.headers, body: Buffer.concat(buffers) });
        const form = await incoming.formData();
        image = form.get("image");
        q = typeof form.get("q") === "string" ? form.get("q") : undefined;
        if (!(image instanceof Blob) || !image.size) return json(response, 400, { error: "Image required" });
      }
      const parsed = backend.listQuerySchema.safeParse({ ...Object.fromEntries(url.searchParams), q,
        type: url.searchParams.get("type") ?? "found", mode: "unified", status: url.searchParams.get("status") || undefined });
      if (!parsed.success) return json(response, 400, { error: parsed.error.issues[0]?.message });
      const input = parsed.data;
      let result;
      if (image) {
        if (input.type === "all") return json(response, 400, { error: "이미지 검색은 분실물 또는 습득물 게시판을 선택해주세요." });
        result = await backend.searchPreviewImage(input.type, q, image, input);
      } else if (url.searchParams.get("mode") === "keyword") result = await backend.searchPosts(input);
      else if (url.searchParams.get("mode") === "semantic") {
        const items = await backend.searchTextCandidatesForFusion(input.type, q, input);
        result = { items: items.slice((input.page - 1) * input.limit, input.page * input.limit), page: input.page, limit: input.limit, total: items.length, totalPages: Math.max(1, Math.ceil(items.length / input.limit)) };
      } else result = await backend.searchUnifiedPosts(input, { disableSemantic: url.searchParams.get("aiFailure") === "1" });
      return json(response, 200, envelope(result));
    } catch { return json(response, 502, { error: "Local search failed" }); }
  }
  if (request.method !== "GET") return json(response, 405, { error: "Read-only local preview" });
  if (url.pathname === "/client.js") { response.setHeader("Content-Type", "text/javascript"); response.end(readFileSync(`${output}/client.js`)); return; }
  if (url.pathname === "/preview-photo.jpg" || url.pathname === "/_next/image") { response.setHeader("Content-Type", "image/jpeg"); response.end(readFileSync("docs/ai-eval-seed/query-images/Q01.jpg")); return; }
  if (url.pathname.startsWith("/post/")) { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end("<p>로컬 평가용 상세 링크입니다. 실제 게시글 페이지를 호출하지 않습니다.</p>"); return; }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MJU Find 통합 검색 로컬 검증</title><style>${css}</style><div id="root"></div><script id="home-preview-posts" type="application/json">${JSON.stringify(homeRecommendations).replace(/</g, "\\u003c")}</script><script src="/client.js"></script></html>`);
}).listen(4210, "127.0.0.1", () => console.log("Unified search preview: http://127.0.0.1:4210/search (no DB writes)"));
