// Read existing room/grant state; optionally send one non-persistent receipt challenge.
import "../db/install-guard.mjs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { assertDatabaseEnvironment, assertScriptSupabaseAccess, PREVIEW_DB_PROJECT, PRODUCTION_DB_PROJECT } from "../../src/lib/db/accessPolicy.mjs";

const [action, confirmation, roomArg, openedAfter, ...extra] = process.argv.slice(2);
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const roomId = Number(roomArg);
const timestamp = openedAfter && new Date(openedAfter);
if (extra.length || !["inspect", "send"].includes(action) || !["preview", "production"].includes(target) ||
    confirmation !== `--confirm-${target}` || assertScriptSupabaseAccess(process.env) !== target ||
    !/^[1-9]\d{0,9}$/.test(roomArg ?? "") || roomId > 2147483647 ||
    (openedAfter && (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== openedAfter)) ||
    (action === "send" && !openedAfter)) {
  throw new Error("Explicit hosted target, room ID and ISO UTC start for dispatch required");
}

const project = target === "production" ? PRODUCTION_DB_PROJECT : PREVIEW_DB_PROJECT;
const db = new Client({ connectionString: process.env.DIRECT_URL, statement_timeout: 5000 });
let stage = "read-room";
try {
  await db.connect();
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const { rows: [room] } = await db.query(`
    SELECT NOT EXISTS(SELECT 1 FROM public."Message" WHERE chat_room_id = r.id) AS empty
    FROM public."ChatRoom" r WHERE r.id = $1
  `, [roomId]);
  if (!room?.empty) throw new Error("Target must be an existing empty room");

  let candidates = [];
  if (timestamp) {
    stage = "read-grant";
    ({ rows: candidates } = await db.query(`
      SELECT g.id, g.created_at AT TIME ZONE 'UTC' AS created_at,
             g.expires_at AT TIME ZONE 'UTC' AS expires_at,
             (SELECT r.id FROM public."ChatRoom" r WHERE r.id <> g.room_id
              AND NOT public.mju_chat_member_allowed(g.user_id, r.id) ORDER BY r.id LIMIT 1) AS outsider_room
      FROM public."ChatRealtimeGrant" g
      JOIN public."ChatRealtimeSession" s ON s.id = g.session_id AND s.user_id = g.user_id
      JOIN public."ChatRealtimeConfig" c ON c.id = true
      WHERE g.room_id = $1 AND g.created_at >= ($2::timestamptz AT TIME ZONE 'UTC')
        AND c.mode = 'private' AND c.project_ref = $3
        AND g.revoked_at IS NULL AND s.revoked_at IS NULL
        AND g.expires_at > (now() AT TIME ZONE 'UTC') AND s.expires_at > (now() AT TIME ZONE 'UTC')
        AND public.mju_chat_member_allowed(g.user_id, g.room_id)
      LIMIT 2
    `, [roomId, timestamp, project]));
  }
  await db.query("ROLLBACK");

  const grant = candidates.length === 1 ? candidates[0] : undefined;
  if (action === "inspect") {
    console.log(JSON.stringify({ target, empty: true, activeProbeGrants: timestamp ? candidates.length : undefined,
      grantCreatedAt: grant?.created_at, grantExpiresAt: grant?.expires_at, outsiderProbeRoomId: grant?.outsider_room }));
  } else {
    stage = "validate-dispatch";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!grant || !key || key === "[SENSITIVE]") throw new Error("One fresh authorized grant and a server credential are required");
    const nonce = randomUUID();
    const topic = encodeURIComponent(`mju-chat:${grant.id}`);
    stage = "dispatch";
    const response = await fetch(`https://${project}.supabase.co/realtime/v1/api/broadcast/${topic}/events/transport_control?private=true`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json", Connection: "close" },
      body: JSON.stringify({ nonce }),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    await response.body?.cancel();
    if (response.status !== 202) throw new Error("Realtime did not accept the event");
    console.log(JSON.stringify({ target, dispatchAccepted: true, expectedReceipt: nonce }));
  }
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  console.error(`Member receipt check stopped at ${stage}:`, error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await db.end();
}
