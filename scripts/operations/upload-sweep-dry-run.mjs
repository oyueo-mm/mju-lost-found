// A-3 dry run, read-only, counts only: what would the daily unattached-upload
// sweep (src/lib/images/uploadIntents.ts sweepUnattachedUploads) do if it ran
// now? Mirrors its query and its reference re-check in SQL; deletes nothing,
// marks nothing, prints no paths.
//   node --env-file=.env.preview.local scripts/operations/upload-sweep-dry-run.mjs
//   node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/upload-sweep-dry-run.mjs
import "../db/install-guard.mjs";
import { Client } from "pg";
import { pgConfig } from "../db/pgConfig.mjs";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

const SWEEP_AFTER_HOURS = 24, SWEEP_BATCH = 200; // keep in step with uploadIntents.ts
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
const publicPrefix = `${base}/storage/v1/object/public/post-images/`;
const db = new Client(pgConfig(process.env.DIRECT_URL, { connectionTimeoutMillis: 15000 }));
await db.connect();
try {
  await db.query("BEGIN READ ONLY");
  // Stored post-image URLs that do NOT have the prefix the re-check compares with (format drift would hide a reference).
  const drift = Number((await db.query(`SELECT (SELECT count(*) FROM "LostPost" WHERE image_url IS NOT NULL AND left(image_url, length($1)) <> $1) + (SELECT count(*) FROM "FoundPost" WHERE image_url IS NOT NULL AND left(image_url, length($1)) <> $1) + (SELECT count(*) FROM "PostImage" WHERE left(image_url, length($1)) <> $1) AS n`, [publicPrefix])).rows[0].n);
  const exists = (await db.query(`SELECT to_regclass('public."UploadIntent"') IS NOT NULL AS e`)).rows[0].e;
  if (!exists) {
    console.log(JSON.stringify({ target, uploadIntentTable: false, note: "table not created yet: the sweep has nothing to examine, and files uploaded before the release are never candidates", storedPostUrlsWithOtherPrefix: drift }));
  } else {
    const r = (await db.query(`
      WITH due AS (
        SELECT path, bucket FROM "UploadIntent"
         WHERE attached_at IS NULL AND deleted_at IS NULL AND created_at < (now() AT TIME ZONE 'UTC') - make_interval(hours => $1)
         ORDER BY created_at LIMIT $2),
      ref AS (
        SELECT d.*, CASE WHEN d.bucket = 'chat-images' THEN EXISTS (SELECT 1 FROM "Message" m WHERE m.image_url = d.path)
          ELSE EXISTS (SELECT 1 FROM "LostPost" p WHERE p.image_url = $3 || d.path)
            OR EXISTS (SELECT 1 FROM "FoundPost" p WHERE p.image_url = $3 || d.path)
            OR EXISTS (SELECT 1 FROM "PostImage" i WHERE i.image_url = $3 || d.path)
            OR EXISTS (SELECT 1 FROM "Message" m WHERE m.image_url = $3 || d.path) END AS referenced
          FROM due d)
      SELECT count(*)::int AS due,
             count(*) FILTER (WHERE referenced)::int AS "wouldMarkAttached",
             count(*) FILTER (WHERE NOT referenced)::int AS "wouldDelete",
             count(*) FILTER (WHERE NOT referenced AND bucket = 'post-images')::int AS "wouldDeletePost",
             count(*) FILTER (WHERE NOT referenced AND bucket = 'chat-images')::int AS "wouldDeleteChat"
        FROM ref`, [SWEEP_AFTER_HOURS, SWEEP_BATCH, publicPrefix])).rows[0];
    const totals = (await db.query(`SELECT count(*)::int AS intents, count(*) FILTER (WHERE attached_at IS NULL AND deleted_at IS NULL)::int AS open, count(*) FILTER (WHERE attached_at IS NOT NULL)::int AS attached, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted FROM "UploadIntent"`)).rows[0];
    console.log(JSON.stringify({ target, uploadIntentTable: true, sweepAfterHours: SWEEP_AFTER_HOURS, totals, ifSweptNow: r, storedPostUrlsWithOtherPrefix: drift }, null, 1));
  }
  await db.query("ROLLBACK");
} finally {
  await db.end();
}
