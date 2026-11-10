#!/usr/bin/env node
import "./db/install-guard.mjs";
// Read-only evaluation of the existing, title-verified synthetic fixtures.
// No post embedding regeneration, service metrics, env changes, or writes.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import pg from "pg";
import { loadSearchPreviewBackend } from "./search-preview-build.mjs";

const folder = ".vercel/unified-search-preview";
mkdirSync(folder, { recursive: true });
const truth = JSON.parse(readFileSync("docs/ai-eval-seed/ground-truth.json", "utf8"));
if (process.argv.includes("--read-preview")) {
  const values = parseEnv(readFileSync(".env.preview.local", "utf8"));
  const connectionString = values.DIRECT_URL;
  if (!connectionString || !new URL(connectionString).username.includes("swqvli")) throw new Error("Preview database identity check failed");
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000, query_timeout: 20000 });
  const snapshot = [];
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    for (const [type, table] of [["lost", "LostPost"], ["found", "FoundPost"]]) {
      const expected = truth.posts.filter((post) => post.board === type);
      const date = type === "lost" ? "lost_date" : "found_date";
      const { rows } = await client.query(`SELECT id,title,description,category,category_code AS "categoryCode",subcategory,location,campus,status::text,
        ${date}::text AS date,created_at AT TIME ZONE 'UTC' AS "createdAt",updated_at AT TIME ZONE 'UTC' AS "updatedAt",
        view_count AS "viewCount",comment_count AS "commentCount",embedding::text AS embedding,"imageEmbedding"::text AS "imageEmbedding"
        FROM "${table}" WHERE id=ANY($1::int[]) AND temp_hidden_at IS NULL AND removed_at IS NULL`, [expected.map((post) => post.id)]);
      for (const row of rows) {
        const fixture = expected.find((post) => post.id === row.id && post.title === row.title);
        if (!fixture) continue; // never label a reused id as an old fixture
        const { date: eventDate, ...rest } = row;
        snapshot.push({ ...rest, type, [type === "lost" ? "lostDate" : "foundDate"]: eventDate,
          embedding: row.embedding ? JSON.parse(row.embedding) : null,
          imageEmbedding: row.imageEmbedding ? JSON.parse(row.imageEmbedding) : null,
          imageUrl: fixture.hasImage ? "/preview-photo.jpg" : null,
          author: { id: 0, nickname: "평가용", publicId: "evaluation", userType: "STUDENT" },
          organizationId: null, organizationName: null,
        });
      }
    }
    await client.query("ROLLBACK");
  } finally { await client.end(); }
  if (snapshot.length !== truth.posts.length) throw new Error("Evaluation fixtures changed; refusing to reuse old labels");
  writeFileSync(`${folder}/posts.json`, JSON.stringify(snapshot));
  console.log(`Read-only Preview snapshot: ${snapshot.length} verified fixtures, existing vectors reused.`);
}
const backend = await loadSearchPreviewBackend();
const base = { type: "found", page: 1, limit: 5 };
const exact = backend.posts.find((post) => post.type === "found" && post.title.includes("지갑"));
const queries = ["핑크색 무언가", "분홍색 무언가", "검은색 지갑", "어제 도서관에서 검은색 반지갑을 잃어버렸어요", "에어팟 한쪽", "학생회관에서 흰색 무선 이어폰 케이스를 주웠어요", "C타입 충전기", "파란색 텀블러", exact.title, "어제 도서관 근처에서 까만 가죽 지갑을 놓고 왔어요", "zzzz-no-existing-fixture-78523"];
const brief = (posts) => posts.slice(0, 5).map((post) => ({ type: post.type, id: post.id, title: post.title }));
const warmup = performance.now();
await backend.searchTextCandidatesForFusion("found", "로컬 평가 모델 준비", {});
const warmModelMs = performance.now() - warmup;
const comparison = [];
for (const q of queries) {
  const count = backend.calls.text;
  const start = performance.now();
  const current = await backend.searchUnifiedPosts({ ...base, q });
  const elapsed = performance.now() - start;
  const embeddings = backend.calls.text - count;
  const oldKeyword = await backend.searchPosts({ ...base, q });
  const oldSemantic = await backend.searchTextCandidatesForFusion("found", q, {});
  const cached = backend.calls.text;
  await backend.searchUnifiedPosts({ ...base, q, page: 2 });
  comparison.push({ query: q, strategy: current.search.strategy, oldKeyword: brief(oldKeyword.items), oldSemantic: brief(oldSemantic), unified: brief(current.items), total: current.total, localWarmElapsedMs: +elapsed.toFixed(2), queryEmbeddings: embeddings, paginationExtraEmbeddings: backend.calls.text - cached });
}
const labelled = [];
for (const pair of truth.pairs) {
  const q = pair.results?.semanticByDemoQuery?.query ?? pair.results?.demoQuery;
  if (typeof q !== "string" || q.length > 100 || !backend.usesSemanticSearch(q)) continue;
  const old = await backend.searchTextCandidatesForFusion("found", q, {});
  const current = await backend.searchUnifiedPosts({ ...base, q });
  const target = pair.found?.id;
  if (!backend.posts.some((post) => post.type === "found" && post.id === target)) continue;
  labelled.push({ pairId: pair.pairId, target, semanticRank: old.findIndex((post) => post.id === target) + 1 || null, unifiedRank: current.items.findIndex((post) => post.id === target) + 1 || null });
}
const hits = (key) => labelled.filter((entry) => entry[key] !== null && entry[key] <= 5).length;
const report = { scope: "249 existing synthetic Preview fixtures; title-verified read-only snapshot; stored vectors; local CPU model; exact cosine scan within the fixture corpus (not live HNSW SQL)", fixtureCount: backend.posts.length, warmModelStartupMs: +warmModelMs.toFixed(2), comparison,
  labelledNaturalDescriptions: { count: labelled.length, oldSemanticHitsAt5: hits("semanticRank"), unifiedHitsAt5: hits("unifiedRank"), ...(labelled.length ? { oldSemanticRecallAt5: hits("semanticRank") / labelled.length, unifiedRecallAt5: hits("unifiedRank") / labelled.length } : {}), cases: labelled },
  failure: (await backend.searchUnifiedPosts({ ...base, q: queries[0] }, { disableSemantic: true })).search,
  limits: "Fixture-only comparison, not production relevance. Representative free-text queries have no labels: no invented accuracy/NDCG. Full SQL/HNSW index behavior and network/serverless cold start are not measured here.",
};
writeFileSync("docs/UNIFIED_SEARCH_COMPARISON.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ fixtureCount: report.fixtureCount, examples: comparison.map((row) => ({ query: row.query, strategy: row.strategy, top5: row.unified.map((post) => post.id), queryEmbeddings: row.queryEmbeddings, paginationExtraEmbeddings: row.paginationExtraEmbeddings, localWarmElapsedMs: row.localWarmElapsedMs })), labelled: { count: labelled.length, oldSemanticHitsAt5: hits("semanticRank"), unifiedHitsAt5: hits("unifiedRank") }, report: "docs/UNIFIED_SEARCH_COMPARISON.json" }, null, 2));
