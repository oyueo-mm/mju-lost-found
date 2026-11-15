import "../db/install-guard.mjs";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { assertDatabaseEnvironment, assertScriptSupabaseAccess } from "../../src/lib/db/accessPolicy.mjs";

if (assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview") throw new Error("Preview only");
assertScriptSupabaseAccess(process.env);
const db = new Client({ connectionString: process.env.DIRECT_URL });
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const queries = {
    migrations: `SELECT migration_name, finished_at IS NOT NULL AS applied FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 3`,
    reports: `SELECT id, reporter_user_id, target_type, target_id, created_at, status,
      reason ~* 'release.?c|snapshot|evidence|test|테스트|검증' AS reason_test_marker,
      coalesce(detail,'') ~* 'release.?c|snapshot|evidence|test|테스트|검증' AS detail_test_marker,
      target_snapshot->'target'->>'kind' AS snapshot_kind,
      jsonb_array_length(coalesce(target_snapshot->'images','[]')) AS snapshot_images
      FROM "Report" WHERE id BETWEEN 70 AND 75 ORDER BY id`,
    rooms: `SELECT id, created_at, direct_lost_post_id, direct_found_post_id, initiator_user_id, counterpart_user_id, organization_id, post_title ~* 'release.?c|snapshot|evidence|test|테스트|검증' AS test_marker FROM "ChatRoom" WHERE id BETWEEN 153 AND 155 ORDER BY id`,
    messages: `SELECT id, chat_room_id, sender_user_id, created_at, image_url IS NOT NULL AS image,
      content ~* 'release.?c|snapshot|evidence|test|테스트|검증' AS test_marker
      FROM "Message" WHERE chat_room_id BETWEEN 153 AND 155 ORDER BY id`,
    notifications: `SELECT related_id, type, count(*)::int AS count, min(created_at) AS first_at, max(created_at) AS last_at FROM "Notification" WHERE related_type='report' AND related_id BETWEEN 70 AND 75 GROUP BY related_id,type ORDER BY related_id`,
    views: `SELECT id, admin_user_id, report_id, chat_room_id, message_id, resource, accessed_at FROM "AdminAccessLog" WHERE report_id BETWEEN 70 AND 75 ORDER BY id`,
    participants: `SELECT id, created_at, is_admin, email ~* 'test|example|e2e' AS test_account_marker FROM "User" WHERE id IN (1,2) ORDER BY id`,
    otherReports: `SELECT count(*)::int AS count FROM "Report" WHERE target_type='message' AND target_id BETWEEN 451 AND 456 AND id NOT BETWEEN 70 AND 75`,
    roomReferences: `SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1] WHERE c.contype='f' AND c.confrelid IN ('"ChatRoom"'::regclass, '"Message"'::regclass) ORDER BY 1,2`,
    dependencies: `SELECT 'ChatRead' AS relation, count(*)::int AS count FROM "ChatRead" WHERE chat_room_id BETWEEN 153 AND 155
      UNION ALL SELECT 'ChatPresence',count(*)::int FROM "ChatPresence" WHERE chat_room_id BETWEEN 153 AND 155
      UNION ALL SELECT 'MessageReaction',count(*)::int FROM "MessageReaction" WHERE message_id BETWEEN 451 AND 456
      UNION ALL SELECT 'PostReturn',count(*)::int FROM "PostReturn" WHERE chat_room_id BETWEEN 153 AND 155
      UNION ALL SELECT 'ThankNote',count(*)::int FROM "ThankNote" WHERE chat_room_id BETWEEN 153 AND 155
      UNION ALL SELECT 'PushOutbox',count(*)::int FROM "PushOutbox" WHERE message_id BETWEEN 451 AND 456
      UNION ALL SELECT 'ExternalReply',count(*)::int FROM "Message" WHERE reply_to_message_id BETWEEN 451 AND 456 AND id NOT BETWEEN 451 AND 456`,
  };
  for (const [name, sql] of Object.entries(queries)) console.log(JSON.stringify({ name, rows: (await db.query(sql)).rows }));
  await db.query("ROLLBACK");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.storage.getBucket("report-evidence");
  if (error) throw new Error("Evidence bucket inspection failed");
  console.log(JSON.stringify({ bucket: data.id, public: data.public, fileSizeLimit: data.file_size_limit, allowedMimeTypes: data.allowed_mime_types }));
  for (const [bucket, folders] of [["chat-images", [153,154,155].map((id) => `chat/${id}`)], ["report-evidence", [70,71,72,73,74,75].map((id) => `reports/${id}`)]]) {
    for (const folder of folders) {
      const listed = await sb.storage.from(bucket).list(folder);
      if (listed.error) throw new Error("Storage listing failed");
      console.log(JSON.stringify({ bucket, folder, objects: listed.data.filter((o) => o.id).map((o) => ({ created_at: o.created_at, updated_at: o.updated_at })) }));
    }
  }
} catch (e) {
  console.error("Preview inspection failed", e.code ?? e.name);
  process.exitCode = 1;
} finally { await db.end(); }
