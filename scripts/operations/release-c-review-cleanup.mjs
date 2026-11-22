import "../db/install-guard.mjs";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { assertDatabaseEnvironment, assertScriptSupabaseAccess } from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";

// User approved creation, verification and cleanup of this one review fixture.
if (assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview") throw new Error("Preview only");
assertScriptSupabaseAccess(process.env);
const apply = process.argv.includes("--apply");
const assert = (ok, why) => { if (!ok) throw new Error(`Review cleanup precondition: ${why}`); };
const db = new Client(pgConfig(process.env.DIRECT_URL));
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let committed = false;
try {
  await db.connect();
  await db.query("BEGIN");
  await db.query("SET LOCAL lock_timeout='3s'");
  const room = (await db.query(`SELECT * FROM "ChatRoom" WHERE id=156 FOR UPDATE`)).rows[0];
  assert(room?.post_title === "release-c-codex-review-20261115" && room.initiator_user_id === 2 && room.counterpart_user_id === 1 && !room.direct_lost_post_id && !room.direct_found_post_id && !room.organization_id, "exact room/owners");
  const messages = (await db.query(`SELECT id,sender_user_id,image_url FROM "Message" WHERE chat_room_id=156 FOR UPDATE`)).rows;
  assert(messages.length===1 && messages[0].id===457 && messages[0].sender_user_id===1 && messages[0].image_url===null, "exact message/original removed");
  const report = (await db.query(`SELECT * FROM "Report" WHERE id=76 FOR UPDATE`)).rows[0];
  assert(report?.detail === "release-c-codex-review-20261115" && report.target_type === "message" && report.target_id===457 && report.reporter_user_id===2 && report.status==='pending', "exact report/owner");
  const images=report.target_snapshot?.images;
  assert(images?.length===1 && images[0].status==='copied' && images[0].path==='reports/76/0.png', "exact evidence");
  const logs=(await db.query(`SELECT id FROM "AdminAccessLog" WHERE report_id=76 AND chat_room_id=156
    AND ((resource='chat_image' AND message_id=457) OR (resource='chat_room' AND (message_id=457 OR message_id IS NULL)))
    AND accessed_at >= (SELECT created_at FROM "Report" WHERE id=76) FOR UPDATE`)).rows;
  const logCount=Number((await db.query(`SELECT count(*) FROM "AdminAccessLog" WHERE report_id=76`)).rows[0].count);
  assert(logs.length===logCount && logs.length>=2, "only fixture access logs");
  const identityLogs=(await db.query(`SELECT id FROM "IdentityAccessLog" WHERE report_id=76 AND target_user_id IN (1,2)
    AND accessed_at >= (SELECT created_at FROM "Report" WHERE id=76)
    AND admin_user_id IN (SELECT admin_user_id FROM "AdminAccessLog" WHERE report_id=76) FOR UPDATE`)).rows;
  const identityCount=Number((await db.query(`SELECT count(*) FROM "IdentityAccessLog" WHERE report_id=76`)).rows[0].count);
  assert(identityLogs.length===identityCount,"only manual-review identity logs for fixture parties");
  const notifications=(await db.query(`SELECT id,type FROM "Notification" WHERE related_type='report' AND related_id=76 FOR UPDATE`)).rows;
  assert(notifications.length===3 && notifications.every((n) => n.type==='report_received'), "exact fixture notifications");
  const outside=Number((await db.query(`SELECT
    (SELECT count(*) FROM "Report" WHERE target_type='message' AND target_id=457 AND id<>76) +
    (SELECT count(*) FROM "Message" WHERE reply_to_message_id=457 AND id<>457) +
    (SELECT count(*) FROM "PostReturn" WHERE chat_room_id=156) +
    (SELECT count(*) FROM "ThankNote" WHERE chat_room_id=156) +
    (SELECT count(*) FROM "PushOutbox" WHERE message_id=457) +
    (SELECT count(*) FROM "MessageReaction" WHERE message_id=457) +
    (SELECT count(*) FROM "ChatPresence" WHERE chat_room_id=156) +
    (SELECT count(*) FROM "ChatRead" WHERE chat_room_id=156) +
    (SELECT count(*) FROM "ModerationAction" WHERE report_id=76) AS n`)).rows[0].n);
  assert(outside===0, "no outside/seed/operational dependencies");
  const source=await sb.storage.from("chat-images").list("chat/156");
  const evidence=await sb.storage.from("report-evidence").list("reports/76");
  assert(!source.error && source.data.length===0, "source folder empty");
  assert(!evidence.error && evidence.data.length===1 && evidence.data[0].name==='0.png', "exact evidence object");
  const summary={roomId:156,messageId:457,reportId:76,notifications:3,testAccessLogs:logs.length,testIdentityLogs:identityLogs.length,evidencePhotos:1};
  if (!apply) { await db.query("ROLLBACK"); console.log(JSON.stringify({dryRun:true,...summary})); }
  else {
    const remove=async (sql,args,count) => assert((await db.query(sql,args)).rowCount===count,"deleted row count");
    await remove(`DELETE FROM "AdminAccessLog" WHERE id=ANY($1::int[])`,[logs.map((l) => l.id)],logs.length);
    await remove(`DELETE FROM "IdentityAccessLog" WHERE id=ANY($1::int[])`,[identityLogs.map((l) => l.id)],identityLogs.length);
    await remove(`DELETE FROM "Notification" WHERE id=ANY($1::int[])`,[notifications.map((n) => n.id)],3);
    await remove(`DELETE FROM "Report" WHERE id=76`,[],1);
    await remove(`DELETE FROM "Message" WHERE id=457`,[],1);
    await remove(`DELETE FROM "ChatRoom" WHERE id=156`,[],1);
    await db.query("COMMIT");committed=true;
    assert(!(await sb.storage.from("report-evidence").remove(["reports/76/0.png"])).error,"evidence removal after commit");
    const remains=await sb.storage.from("report-evidence").list("reports/76");
    assert(!remains.error && remains.data.length===0,"evidence absence");
    console.log(JSON.stringify({deleted:true,...summary}));
  }
} catch(e) { await db.query("ROLLBACK").catch(() => {}); console.error("Review cleanup stopped", {committed,error:e.message?.startsWith("Review cleanup precondition:")?e.message:e.code??e.name});process.exitCode=1; }
finally { await db.end(); }
