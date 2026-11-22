// One-off removal of an operator-created TEST chat room, its messages and the
// single test post it came from. Run ONLY through approved-operation.mjs.
// Without --apply it only checks and prints the manifest (counts, no content).
//
//   node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- \
//     scripts/operations/cleanup-test-chat-room.mjs --confirm-production 52 8 [--apply]
//
// Direct pg (like the other operations scripts): the app's Prisma module
// refuses Production outside the Production runtime, by design.
//
// Refuses (changes nothing) unless ALL hold:
//   - 1:1 room (no organization), exactly <messages> messages, all from its two
//     participants, no chat image;
//   - linked to exactly one post, owned by a participant, title marks a test
//     ("시험"/"test"), no photo (cover or PostImage);
//   - no other room on that post; no comment by anyone else; no thank-note,
//     return or report on the room, its messages or the post;
//   - every FK in the database that points at the post or room is one this
//     script handles (checked against pg_constraint at run time).
// Deletes in ONE transaction (mirrors posts/service.ts deletePostRowInTx):
// the participants' notifications for those messages, the room (messages,
// reads, reactions, grants, presence, push outbox cascade), the post's
// derived rows (views, status changes, match caches) and the post
// (comments, images cascade). Re-checks everything inside that transaction.
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";

const [confirmation, roomArg, messagesArg, ...rest] = process.argv.slice(2);
const apply = rest.includes("--apply");
// --post=lost:<id>|found:<id>: the operator confirmed this exact post as the
// test post (used instead of the title check when the title has no marker).
const postFlag = rest.find((a) => a.startsWith("--post="));
const confirmedPost = postFlag?.match(/^--post=(lost|found):([1-9]\d{0,9})$/);
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
if (rest.some((a) => a !== "--apply" && a !== postFlag) || (postFlag && !confirmedPost) || confirmation !== `--confirm-${target}` || !["production", "preview"].includes(target) || !/^[1-9]\d{0,9}$/.test(roomArg ?? "") || !/^[1-9]\d{0,4}$/.test(messagesArg ?? "")) {
  throw new Error("usage: cleanup-test-chat-room.mjs --confirm-<target> <room> <expectedMessages> [--apply]");
}
const roomId = Number(roomArg), expectedMessages = Number(messagesArg);
const refuse = (why) => { throw new Error(`refused: ${why}`); };
const db = new Client(pgConfig(process.env.DIRECT_URL, { statement_timeout: 10000 }));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const n = async (sql, params = []) => Number((await one(sql, params)).n);

// FKs this script accounts for: [referencing table, column, behaviour]
const HANDLED = {
  ChatRoom: new Set(["Message.chat_room_id", "ChatRead.chat_room_id", "ChatRealtimeGrant.room_id", "ChatPresence.chat_room_id", "ThankNote.chat_room_id", "PostReturn.chat_room_id"]),
  Post: new Set(["ChatRoom.direct_lost_post_id", "ChatRoom.direct_found_post_id", "Comment.lost_post_id", "Comment.found_post_id", "PostImage.lost_post_id", "PostImage.found_post_id"]),
};

async function manifest() {
  const room = await one(`SELECT id, organization_id, initiator_user_id, counterpart_user_id, direct_lost_post_id, direct_found_post_id FROM "ChatRoom" WHERE id=$1 FOR UPDATE`, [roomId]);
  if (!room) refuse("room not found");
  if (room.organization_id !== null) refuse("organization room");
  const members = [room.initiator_user_id, room.counterpart_user_id];
  if (members.some((m) => m === null) || members[0] === members[1]) refuse("not a 1:1 room");
  if (Boolean(room.direct_lost_post_id) === Boolean(room.direct_found_post_id)) refuse("room is not linked to exactly one post");
  const postType = room.direct_lost_post_id ? "lost" : "found";
  const postTable = postType === "lost" ? "LostPost" : "FoundPost";
  const postCol = postType === "lost" ? "lost_post_id" : "found_post_id";
  const postId = room.direct_lost_post_id ?? room.direct_found_post_id;
  const post = await one(`SELECT user_id, title, image_url FROM "${postTable}" WHERE id=$1 FOR UPDATE`, [postId]);
  if (!post) refuse("post not found");
  if (!members.includes(post.user_id)) refuse("post owner is not a participant");
  if (confirmedPost) { if (confirmedPost[1] !== postType || Number(confirmedPost[2]) !== postId) refuse(`room is linked to ${postType}:${postId}, not the confirmed post`); }
  else if (!/시험|test/i.test(post.title)) refuse(`post ${postType}:${postId} title does not mark a test; confirm it with --post=${postType}:${postId}`);
  if (post.image_url) refuse("post has a cover photo");
  if (await n(`SELECT count(*) n FROM "PostImage" WHERE ${postCol}=$1`, [postId])) refuse("post has photos");
  const messages = (await db.query(`SELECT id, sender_user_id, image_url FROM "Message" WHERE chat_room_id=$1`, [roomId])).rows;
  if (messages.length !== expectedMessages) refuse(`message count ${messages.length} != ${expectedMessages}`);
  if (messages.some((m) => !members.includes(m.sender_user_id))) refuse("message from a non-participant");
  if (messages.some((m) => m.image_url)) refuse("chat image present");
  const ids = messages.map((m) => m.id);
  if (await n(`SELECT count(*) n FROM "ChatRoom" WHERE id<>$1 AND (${postType === "lost" ? "direct_lost_post_id" : "direct_found_post_id"})=$2`, [roomId, postId])) refuse("another room uses the post");
  if (await n(`SELECT count(*) n FROM "Comment" WHERE ${postCol}=$1 AND author_user_id <> ALL($2::int[])`, [postId, members])) refuse("post has comments by others");
  const thank = await n(`SELECT count(*) n FROM "ThankNote" WHERE chat_room_id=$1`, [roomId]);
  const ret = await n(`SELECT count(*) n FROM "PostReturn" WHERE chat_room_id=$1`, [roomId]);
  const reports = await n(`SELECT count(*) n FROM "Report" WHERE (target_type='message' AND target_id = ANY($1::int[])) OR (target_type='post' AND target_id=$2)`, [ids, postType === "lost" ? postId : -postId]);
  if (thank || ret || reports) refuse(`linked records thank=${thank} return=${ret} report=${reports}`);
  // every FK pointing at the room / post table must be one handled above or a cascade from Message
  const fks = (await db.query(`SELECT c.conrelid::regclass::text AS t, a.attname AS col, c.confrelid::regclass::text AS ref FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.contype='f' AND c.confrelid IN ('public."ChatRoom"'::regclass, $1::regclass)`, [`public."${postTable}"`])).rows;
  const unknown = fks.map((f) => `${f.t.replaceAll('"', "").replace(/^public\./, "")}.${f.col}|${f.ref.includes("ChatRoom") ? "ChatRoom" : "Post"}`).filter((k) => { const [col, kind] = k.split("|"); return !HANDLED[kind].has(col); });
  for (const k of unknown) { // an unhandled FK is acceptable only if it references nothing here
    const [col, kind] = k.split("|"); const [t, c] = col.split(".");
    if (await n(`SELECT count(*) n FROM "${t}" WHERE "${c}"=$1`, [kind === "ChatRoom" ? roomId : postId])) refuse(`unhandled reference ${col}`);
  }
  const notifications = await n(`SELECT count(*) n FROM "Notification" WHERE user_id = ANY($1::int[]) AND related_type='message' AND related_id = ANY($2::int[])`, [members, ids]);
  const comments = await n(`SELECT count(*) n FROM "Comment" WHERE ${postCol}=$1`, [postId]);
  return { members, ids, postType, postTable, postId, printable: { roomId, postType, postId, confirmedBy: confirmedPost ? "operator --post" : "title marker", postOwnerIsParticipant: true, messages: ids.length, senders: "participants only", chatImages: 0, postPhotos: 0, ownComments: comments, notificationsToRemove: notifications, otherRoomsOnPost: 0, thankNotes: 0, returns: 0, reports: 0, unhandledReferences: 0 } };
}

try {
  await db.connect();
  await db.query("BEGIN");
  const m = await manifest();
  console.log(JSON.stringify({ target, apply, manifest: m.printable }));
  if (!apply) { await db.query("ROLLBACK"); }
  else {
    const notif = await db.query(`DELETE FROM "Notification" WHERE user_id = ANY($1::int[]) AND related_type='message' AND related_id = ANY($2::int[])`, [m.members, m.ids]);
    const room = await db.query(`DELETE FROM "ChatRoom" WHERE id=$1`, [roomId]);
    // deletePostRowInTx / deletePostDerivedDataInTx, same order
    const other = m.postType === "lost" ? "found" : "lost";
    await db.query(`DELETE FROM "PostView" WHERE post_type=$1 AND post_id=$2`, [m.postType, m.postId]);
    await db.query(`DELETE FROM "PostStatusChange" WHERE post_type=$1 AND post_id=$2`, [m.postType, m.postId]);
    await db.query(`DELETE FROM "MatchCandidateCache" WHERE source_type=$1 AND source_post_id=$2`, [m.postType, m.postId]);
    await db.query(`DELETE FROM "MatchCandidateCache" WHERE source_type=$1 AND candidates -> 'ranking' @> $2::jsonb`, [other, JSON.stringify([{ id: m.postId }])]);
    const post = await db.query(`DELETE FROM "${m.postTable}" WHERE id=$1`, [m.postId]);
    if (room.rowCount !== 1 || post.rowCount !== 1) refuse("unexpected delete count");
    await db.query("COMMIT");
    const after = {
      room: await n(`SELECT count(*) n FROM "ChatRoom" WHERE id=$1`, [roomId]),
      messages: await n(`SELECT count(*) n FROM "Message" WHERE chat_room_id=$1`, [roomId]),
      post: await n(`SELECT count(*) n FROM "${m.postTable}" WHERE id=$1`, [m.postId]),
      grants: await n(`SELECT count(*) n FROM "ChatRealtimeGrant" WHERE room_id=$1`, [roomId]),
    };
    console.log(JSON.stringify({ target, deleted: true, notificationsDeleted: notif.rowCount, after }));
  }
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  console.log(JSON.stringify({ target, apply, error: String(error.message).slice(0, 200) }));
  process.exitCode = 1;
} finally {
  await db.end();
}
