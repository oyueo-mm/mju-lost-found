// Aggregate-only, read-only image embedding queue status. Never drains, claims
// or changes jobs; no post titles, users or URLs are printed.
//   Preview:    node --env-file=.env.preview.local scripts/operations/image-job-status.mjs [--since=<ISO time>]
//   Production: node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/image-job-status.mjs [--since=<ISO time>]
// --since limits the "new posts" section to posts created after a release.
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

// --post=lost:<id> adds one post's job/vector state (no title, user or URL).
const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.slice(8);
const since = sinceArg ? new Date(sinceArg) : null;
if (sinceArg && !Number.isFinite(since?.getTime())) throw new Error("Invalid --since");
const postArg = process.argv.find((a) => a.startsWith("--post="))?.slice(7);
const postMatch = postArg ? /^(lost|found):([1-9]\d{0,9})$/.exec(postArg) : null;
if (postArg && !postMatch) throw new Error("--post=lost:<id> or found:<id>");
if (process.argv.slice(2).some((a) => !a.startsWith("--since=") && !a.startsWith("--post="))) throw new Error("Only --since=<ISO time> and --post=<type>:<id> are accepted");
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
  let post = null;
  if (postMatch) {
    const [, kind, id] = postMatch;
    const table = kind === "lost" ? '"LostPost"' : '"FoundPost"';
    const column = kind === "lost" ? "lost_post_id" : "found_post_id";
    post = (await db.query(`SELECT p.id,p.created_at,p.updated_at,p.image_url IS NOT NULL AS has_image_url,
        split_part(p.image_url,'/',3) AS image_host,p.image_url LIKE '%/post-images/posts/${kind}/' || p.id || '/%' AS own_bucket_path,
        vector_dims(p."imageEmbedding") AS image_dims,vector_dims(p.embedding) AS text_dims,
        (SELECT count(*)::int FROM "PostImage" i WHERE i.${column}=p.id) AS post_images,
        j.state,j.attempts,j.generation,j.desired_hash=j.completed_hash AS current,j.last_error,j.updated_at AS job_updated_at,
        round(extract(epoch FROM j.updated_at - p.created_at)::numeric,1) AS create_to_job_update_s
      FROM ${table} p LEFT JOIN "ImageEmbeddingJob" j ON j.post_type=$1 AND j.post_id=p.id WHERE p.id=$2`, [kind, Number(id)])).rows[0] ?? { missing: true };
  }
  const runtime = (await db.query(`SELECT enabled,resume_at <= (clock_timestamp() AT TIME ZONE 'UTC') AS active FROM "ImageEmbeddingRuntime" WHERE id=true`)).rows[0] ?? null;
  await db.query("ROLLBACK");
  console.log(JSON.stringify({ target, at: new Date().toISOString(), since: since?.toISOString() ?? null, runtime, states, nonCompletedErrors: errors, posts, recent, post }, null, 1));
} finally {
  await db.end().catch(() => {});
}
