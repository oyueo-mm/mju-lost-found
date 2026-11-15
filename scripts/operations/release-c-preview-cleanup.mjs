import "../db/install-guard.mjs";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { assertDatabaseEnvironment, assertScriptSupabaseAccess } from "../../src/lib/db/accessPolicy.mjs";

// Explicit user approval: only the six old release-C reports, three rooms,
// their test messages/photos, 18 notifications, and audit row 8. Never users.
if (assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview") throw new Error("Preview only");
assertScriptSupabaseAccess(process.env);
const apply = process.argv.includes("--apply");
const db = new Client({ connectionString: process.env.DIRECT_URL });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const assert = (condition, name) => { if (!condition) throw new Error(`Cleanup precondition failed: ${name}`); };
let committed = false;
try {
  await db.connect();
  await db.query("BEGIN");
  await db.query("SET LOCAL lock_timeout='3s'");
  const rooms = (await db.query(`SELECT id FROM "ChatRoom" WHERE id BETWEEN 153 AND 155 AND initiator_user_id=2 AND counterpart_user_id=1
    AND organization_id IS NULL AND direct_lost_post_id IS NULL AND direct_found_post_id IS NULL
    AND post_title ~* 'release.?c|snapshot|evidence|test|테스트|검증'
    AND created_at BETWEEN TIMESTAMP '2026-11-15 05:50:00' AND TIMESTAMP '2026-11-15 06:00:00' ORDER BY id FOR UPDATE`)).rows;
  assert(rooms.length === 3, "room ownership/time/marker");
  const messages = (await db.query(`SELECT id, chat_room_id, sender_user_id, image_url FROM "Message" WHERE chat_room_id BETWEEN 153 AND 155 ORDER BY id FOR UPDATE`)).rows;
  assert(messages.length === 6 && messages.every((m, i) => m.id === 451+i && m.chat_room_id === 153+Math.floor(i/2) && m.sender_user_id === (i<2 ? 2 : 1)), "exact messages/owners");
  const expected = [[70,"post",247],[71,"comment",56],[72,"message",454],[73,"post",248],[74,"comment",57],[75,"message",456]];
  const reports = (await db.query(`SELECT id,target_type,target_id FROM "Report" WHERE id BETWEEN 70 AND 75 AND reporter_user_id=2
    AND status='pending' AND target_snapshot IS NULL AND created_at BETWEEN TIMESTAMP '2026-11-15 05:50:00' AND TIMESTAMP '2026-11-15 06:00:00' ORDER BY id FOR UPDATE`)).rows;
  assert(JSON.stringify(reports.map((r) => [r.id,r.target_type,r.target_id])) === JSON.stringify(expected), "exact reports/owners/time");
  const audit = (await db.query(`SELECT id FROM "AdminAccessLog" WHERE report_id BETWEEN 70 AND 75 FOR UPDATE`)).rows;
  assert(audit.length===1 && audit[0].id===8, "only approved audit row");
  const auditMatch = await db.query(`SELECT 1 FROM "AdminAccessLog" WHERE id=8 AND report_id=75 AND admin_user_id=2 AND chat_room_id=155 AND message_id=456 AND resource='chat_image'
    AND accessed_at BETWEEN TIMESTAMP '2026-11-15 05:55:00' AND TIMESTAMP '2026-11-15 05:56:00'`);
  assert(auditMatch.rowCount===1, "audit ownership/time");
  const notifications = (await db.query(`SELECT id,type FROM "Notification" WHERE related_type='report' AND related_id BETWEEN 70 AND 75 FOR UPDATE`)).rows;
  assert(notifications.length===18 && notifications.every((n) => n.type==='report_received'), "exact notifications");
  const forbidden = (await db.query(`SELECT
    (SELECT count(*) FROM "PostReturn" WHERE chat_room_id BETWEEN 153 AND 155) +
    (SELECT count(*) FROM "ThankNote" WHERE chat_room_id BETWEEN 153 AND 155) +
    (SELECT count(*) FROM "PushOutbox" WHERE message_id BETWEEN 451 AND 456) +
    (SELECT count(*) FROM "MessageReaction" WHERE message_id BETWEEN 451 AND 456) +
    (SELECT count(*) FROM "ChatPresence" WHERE chat_room_id BETWEEN 153 AND 155) +
    (SELECT count(*) FROM "Message" WHERE reply_to_message_id BETWEEN 451 AND 456 AND id NOT BETWEEN 451 AND 456) +
    (SELECT count(*) FROM "Report" WHERE target_type='message' AND target_id BETWEEN 451 AND 456 AND id NOT BETWEEN 70 AND 75) +
    (SELECT count(*) FROM "IdentityAccessLog" WHERE report_id BETWEEN 70 AND 75) +
    (SELECT count(*) FROM "ModerationAction" WHERE report_id BETWEEN 70 AND 75) AS n`)).rows[0];
  assert(Number(forbidden.n)===0, "no outside dependencies");
  const reads = (await db.query(`SELECT user_id FROM "ChatRead" WHERE chat_room_id BETWEEN 153 AND 155`)).rows;
  assert(reads.length===1 && [1,2].includes(reads[0].user_id), "test read cursor only");
  const paths = [];
  for (const id of [153,154,155]) {
    const listed = await sb.storage.from("chat-images").list(`chat/${id}`);
    assert(!listed.error && listed.data.length === (id===155 ? 0 : 1), "exact source photos");
    for (const object of listed.data) {
      const p = `chat/${id}/${object.name}`;
      assert(messages.some((m) => m.image_url===p), "photo belongs to exact message");
      assert(object.created_at >= "2026-11-15T05:50:00" && object.created_at < "2026-11-15T06:00:00", "photo creation time");
      paths.push(p);
    }
  }
  for (let id=70; id<=75; id++) {
    const listed = await sb.storage.from("report-evidence").list(`reports/${id}`);
    assert(!listed.error && listed.data.length===0, "old evidence folders empty");
  }
  for (const p of paths) {
    const other = await db.query(`SELECT 1 FROM "Message" WHERE image_url=$1 AND id NOT BETWEEN 451 AND 456`, [p]);
    assert(other.rowCount===0, "photo not shared");
  }
  const summary = { rooms:3, messages:6, reports:6, notifications:18, testAuditRows:1, testReadCursors:1, chatPhotos:paths.length, evidencePhotos:0 };
  if (!apply) { await db.query("ROLLBACK"); console.log(JSON.stringify({ dryRun:true, ...summary })); }
  else {
    const remove = async (sql, args, expectedCount) => assert((await db.query(sql,args)).rowCount === expectedCount, "deleted row count");
    await remove(`DELETE FROM "AdminAccessLog" WHERE id=8`, [], 1);
    await remove(`DELETE FROM "Notification" WHERE id=ANY($1::int[])`, [notifications.map((n) => n.id)], 18);
    await remove(`DELETE FROM "Report" WHERE id BETWEEN 70 AND 75`, [], 6);
    await remove(`DELETE FROM "Message" WHERE id BETWEEN 451 AND 456`, [], 6);
    await remove(`DELETE FROM "ChatRoom" WHERE id BETWEEN 153 AND 155`, [], 3);
    await db.query("COMMIT");
    committed=true;
    const removed = await sb.storage.from("chat-images").remove(paths);
    assert(!removed.error, "test photo removal (DB already committed)");
    for (const id of [153,154,155]) {
      const remains=await sb.storage.from("chat-images").list(`chat/${id}`);
      assert(!remains.error && remains.data.length===0, "test photo absence");
    }
    console.log(JSON.stringify({ deleted:true, ...summary }));
  }
} catch (e) { await db.query("ROLLBACK").catch(() => {}); console.error("Preview cleanup stopped", { committed, error: e.message?.startsWith("Cleanup precondition") ? e.message : (e.code ?? e.name) }); process.exitCode=1; }
finally { await db.end(); }
