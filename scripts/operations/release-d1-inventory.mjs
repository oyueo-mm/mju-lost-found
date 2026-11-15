import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { isAllowedOptimizedImageUrl } from "../../src/lib/images/optimizationHosts.mjs";

// Aggregate-only, read-only evidence for rate budgets and image allowlists.
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const db = new Client({ connectionString: process.env.DIRECT_URL });
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  await db.query("SET LOCAL statement_timeout='15s'");
  const urls = (await db.query(`SELECT image_url FROM "LostPost" WHERE image_url IS NOT NULL UNION ALL SELECT image_url FROM "FoundPost" WHERE image_url IS NOT NULL UNION ALL SELECT image_url FROM "PostImage"`)).rows;
  const hosts = {};
  const pathKinds = {};
  let invalid = 0;
  for (const { image_url: value } of urls) {
    try {
      const u = new URL(value);
      const key = `${u.protocol}//${u.hostname}|${u.pathname.startsWith('/storage/v1/object/public/post-images/') ? 'post-images' : 'other'}`;
      hosts[key] = (hosts[key] ?? 0) + 1;
      const kind = /^\/storage\/v1\/object\/public\/post-images\/(posts\/(?:lost|found)|ai-eval-seed)\//.exec(u.pathname)?.[1] ?? "other";
      pathKinds[kind] = (pathKinds[kind] ?? 0) + 1;
    } catch { invalid++; }
  }
  const rejected = urls.filter(r => !isAllowedOptimizedImageUrl(r.image_url)).length;
  console.log(JSON.stringify({ target, imageReferences: urls.length, invalid, hosts, pathKinds, rejectedByAllowlist: rejected }));
  if (rejected) throw new Error("Existing image rejected by allowlist");
  if (process.argv.includes("--optimize")) {
    const statuses = [];
    for (const width of [128, 256, 640, 1080]) {
      const query = new URLSearchParams({ url: urls[0].image_url, w: String(width), q: "75" });
      const response = await fetch(`http://127.0.0.1:3033/_next/image?${query}`, { signal: AbortSignal.timeout(30000) });
      const bytes = (await response.arrayBuffer()).byteLength;
      statuses.push({ width, status: response.status, image: response.headers.get("content-type")?.startsWith("image/"), bytes });
    }
    console.log(JSON.stringify({ localOptimization: statuses }));
    if (statuses.some(r => r.status !== 200 || !r.image || !r.bytes)) throw new Error("Optimization failed");
  }
  if (process.argv.includes("--images")) {
    const unique = [...new Set(urls.map(r => r.image_url))];
    const results = [];
    // Read existing public images only. No image paths or response bodies logged.
    for (let i = 0; i < unique.length; i += 6) {
      results.push(...await Promise.all(unique.slice(i, i + 6).map(async url => {
        try {
          const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15000), redirect: "error" });
          return response.ok ? "ok" : `http_${response.status}`;
        } catch { return "network_error"; }
      })));
    }
    const counts = {};
    for (const result of results) counts[result] = (counts[result] ?? 0) + 1;
    console.log(JSON.stringify({ publicImageChecks: unique.length, counts }));
    if (counts.ok !== unique.length) throw new Error("Existing image not available");
  }
  for (const [name, table, owner] of [["comments","Comment","author_user_id"],["feedback","Feedback","user_id"],["thanks","ThankNote","sender_user_id"],["keywords","KeywordAlert","user_id"],["lostPosts","LostPost","user_id"],["foundPosts","FoundPost","user_id"]]) {
    const stats = (await db.query(`WITH samples AS (SELECT "${owner}" AS actor, created_at FROM "${table}" WHERE created_at >= (now() AT TIME ZONE 'UTC')-interval '30 days'),
      minutes AS (SELECT count(*)::int n FROM samples GROUP BY actor,date_trunc('minute',created_at)),
      hours AS (SELECT count(*)::int n FROM samples GROUP BY actor,date_trunc('hour',created_at)),
      days AS (SELECT count(*)::int n FROM samples GROUP BY actor,date_trunc('day',created_at+interval '9 hours'))
      SELECT (SELECT count(*)::int FROM samples) AS total_30d, (SELECT coalesce(max(n),0) FROM minutes) AS peak_user_minute,
      (SELECT coalesce(max(n),0) FROM hours) AS peak_user_hour,(SELECT coalesce(max(n),0) FROM days) AS peak_user_day`)).rows[0];
    console.log(JSON.stringify({ name, ...stats }));
  }
  const api = (await db.query(`SELECT route,sum(count)::int AS requests_30d, round(sum(total_ms)::numeric/nullif(sum(count),0),1) AS mean_ms FROM "ApiMetricHourly" WHERE hour >= (now() AT TIME ZONE 'UTC')-interval '30 days' AND (route LIKE '%posts%' OR route LIKE '%upload%') GROUP BY route ORDER BY route`)).rows;
  console.log(JSON.stringify({ api }));
  await db.query("ROLLBACK");
} catch (e) { console.error("Read-only inventory failed", e.code ?? e.name); process.exitCode=1; }
finally { await db.end(); }
