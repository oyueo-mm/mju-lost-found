// Aggregate-only, read-only image embedding queue status. Never drains, claims
// or changes jobs; no post titles, users or URLs are printed.
//   Preview:    node --env-file=.env.preview.local scripts/operations/image-job-status.mjs [--since=<ISO time>]
//   Production: node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/image-job-status.mjs [--since=<ISO time>]
// --since limits the "new posts" section to posts created after a release.
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.slice(8);
const since = sinceArg ? new Date(sinceArg) : null;
if (sinceArg && !Number.isFinite(since?.getTime())) throw new Error("Invalid --since");
if (process.argv.slice(2).some((a) => !a.startsWith("--since="))) throw new Error("Only --since=<ISO time> is accepted");
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const db = new Client({ connectionString: process.env.DIRECT_URL, connectionTimeoutMillis: 15000 });
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const states = (await db.query(`SELECT state,count(*)::int AS jobs,count(*) FILTER (WHERE attempts>1)::int AS retried,max(attempts)::int AS max_attempts,
      round(extract(epoch FROM (now() AT TIME ZONE 'UTC') - min(updated_at)))::int AS oldest_age_s
    FROM "ImageEmbeddingJob" GROUP BY state ORDER BY state`)).rows;
  const errors = (await db.query(`SELECT last_error,count(*)::int AS jobs FROM "ImageEmbeddingJob" WHERE state<>'completed' AND last_error IS NOT NULL GROUP BY last_error ORDER BY 2 DESC`)).rows;
  const posts = (await db.query(`SELECT kind,count(*)::int AS with_image,count(*) FILTER (WHERE has_embedding)::int AS embedded,
      count(*) FILTER (WHERE NOT has_embedding AND job_state IS NULL)::int AS missing_no_job,
      count(*) FILTER (WHERE NOT has_embedding AND job_state IS NOT NULL)::int AS missing_with_job
    FROM (
      SELECT 'lost' AS kind,p."imageEmbedding" IS NOT NULL AS has_embedding,j.state AS job_state FROM "LostPost" p LEFT JOIN "ImageEmbeddingJob" j ON j.post_type='lost' AND j.post_id=p.id WHERE p.image_url IS NOT NULL
      UNION ALL
      SELECT 'found',p."imageEmbedding" IS NOT NULL,j.state FROM "FoundPost" p LEFT JOIN "ImageEmbeddingJob" j ON j.post_type='found' AND j.post_id=p.id WHERE p.image_url IS NOT NULL
    ) x GROUP BY kind ORDER BY kind`)).rows;
  let recent = null;
  if (since) {
    recent = (await db.query(`SELECT kind,count(*)::int AS new_with_image,count(*) FILTER (WHERE has_embedding)::int AS embedded,
        count(*) FILTER (WHERE job_state='completed' AND current)::int AS job_completed_current,
        round(max(extract(epoch FROM job_updated - created_at)))::int AS max_create_to_job_update_s
      FROM (
        SELECT 'lost' AS kind,p.created_at,p."imageEmbedding" IS NOT NULL AS has_embedding,j.state AS job_state,j.desired_hash=j.completed_hash AS current,j.updated_at AS job_updated FROM "LostPost" p LEFT JOIN "ImageEmbeddingJob" j ON j.post_type='lost' AND j.post_id=p.id WHERE p.image_url IS NOT NULL AND p.created_at >= $1::timestamptz AT TIME ZONE 'UTC'
        UNION ALL
        SELECT 'found',p.created_at,p."imageEmbedding" IS NOT NULL,j.state,j.desired_hash=j.completed_hash,j.updated_at FROM "FoundPost" p LEFT JOIN "ImageEmbeddingJob" j ON j.post_type='found' AND j.post_id=p.id WHERE p.image_url IS NOT NULL AND p.created_at >= $1::timestamptz AT TIME ZONE 'UTC'
      ) x GROUP BY kind ORDER BY kind`, [since.toISOString()])).rows;
  }
  const runtime = (await db.query(`SELECT enabled,resume_at <= (clock_timestamp() AT TIME ZONE 'UTC') AS active FROM "ImageEmbeddingRuntime" WHERE id=true`)).rows[0] ?? null;
  await db.query("ROLLBACK");
  console.log(JSON.stringify({ target, at: new Date().toISOString(), since: since?.toISOString() ?? null, runtime, states, nonCompletedErrors: errors, posts, recent }, null, 1));
} finally {
  await db.end().catch(() => {});
}
