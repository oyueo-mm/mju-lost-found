// Read-only check that a deleted post left nothing behind: DB rows that point
// at it and its Storage folder. Counts only; no titles, users or URLs.
// History tables (views, status changes, admin log) may legitimately keep rows
// and are reported as informational.
//   Preview:    node --env-file=.env.preview.local scripts/operations/post-cleanup-check.mjs --post=lost:<id>
//   Production: node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/post-cleanup-check.mjs --post=lost:<id>
import "../db/install-guard.mjs";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { assertDatabaseEnvironment, assertScriptSupabaseAccess } from "../../src/lib/db/accessPolicy.mjs";

const arg = process.argv.find((a) => a.startsWith("--post="))?.slice(7);
const match = arg ? /^(lost|found):([1-9]\d{0,9})$/.exec(arg) : null;
if (!match || process.argv.length !== 3) throw new Error("--post=lost:<id> or found:<id> required");
const [, kind, rawId] = match;
const id = Number(rawId);
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
if (assertScriptSupabaseAccess(process.env) !== target) throw new Error("Database and Storage targets differ");
const db = new Client({ connectionString: process.env.DIRECT_URL, connectionTimeoutMillis: 15000 });
const table = kind === "lost" ? '"LostPost"' : '"FoundPost"';
const column = kind === "lost" ? "lost_post_id" : "found_post_id";
const mustBeEmpty = {}, informational = {};
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const count = async (sql, args = []) => (await db.query(sql, args)).rows[0].n;
  const exists = async (name) => (await db.query(`SELECT to_regclass($1) IS NOT NULL AS t`, [`public."${name}"`])).rows[0].t;
  mustBeEmpty.post = await count(`SELECT count(*)::int n FROM ${table} WHERE id=$1`, [id]);
  mustBeEmpty.postImages = await count(`SELECT count(*)::int n FROM "PostImage" WHERE ${column}=$1`, [id]);
  mustBeEmpty.imageJob = await count(`SELECT count(*)::int n FROM "ImageEmbeddingJob" WHERE post_type=$1 AND post_id=$2`, [kind, id]);
  if (await exists("TextEmbeddingJob")) mustBeEmpty.textJob = await count(`SELECT count(*)::int n FROM "TextEmbeddingJob" WHERE post_type=$1 AND post_id=$2`, [kind, id]);
  mustBeEmpty.recommendationCache = await count(`SELECT count(*)::int n FROM "MatchCandidateCache" WHERE source_type=$1 AND source_post_id=$2`, [kind, id]);
  mustBeEmpty.comments = await count(`SELECT count(*)::int n FROM "Comment" WHERE ${column}=$1`, [id]);
  mustBeEmpty.chatRooms = await count(`SELECT count(*)::int n FROM "ChatRoom" WHERE direct_${kind}_post_id=$1`, [id]);
  mustBeEmpty.keywordAlertMatches = await count(`SELECT count(*)::int n FROM "KeywordAlertMatch" WHERE post_type=$1 AND post_id=$2`, [kind, id]);
  mustBeEmpty.categoryReview = await count(`SELECT count(*)::int n FROM "PostCategoryReview" WHERE ${column}=$1`, [id]);
  mustBeEmpty.returns = await count(`SELECT count(*)::int n FROM "PostReturn" WHERE post_type=$1 AND post_id=$2`, [kind, id]);
  mustBeEmpty.thankNotes = await count(`SELECT count(*)::int n FROM "ThankNote" WHERE post_type=$1 AND post_id=$2`, [kind, id]);
  informational.views = await count(`SELECT count(*)::int n FROM "PostView" WHERE post_type=$1 AND post_id=$2`, [kind, id]);
  informational.statusChanges = await count(`SELECT count(*)::int n FROM "PostStatusChange" WHERE post_type=$1 AND post_id=$2`, [kind, id]);
  informational.reports = await count(`SELECT count(*)::int n FROM "Report" WHERE target_id=$1 AND target_type::text ILIKE $2`, [id, `%${kind}%`]);
  informational.notifications = await count(`SELECT count(*)::int n FROM "Notification" WHERE related_id=$1 AND related_type::text ILIKE $2`, [id, `%${kind}%`]);
  informational.otherPostsCachesMentioning = await count(`SELECT count(*)::int n FROM "MatchCandidateCache" WHERE candidates::text LIKE $1`, [`%"id": ${id}%`]);
  await db.query("ROLLBACK");
} finally {
  await db.end().catch(() => {});
}
const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const listed = await storage.storage.from("post-images").list(`posts/${kind}/${id}`, { limit: 100 });
if (listed.error) throw new Error("Storage list failed");
mustBeEmpty.storageObjects = listed.data.length;
const passed = Object.values(mustBeEmpty).every((n) => n === 0);
console.log(JSON.stringify({ target, post: `${kind}:${id}`, passed, mustBeEmpty, informational }, null, 1));
if (!passed) process.exitCode = 1;
