// Read-only, counts only: which existing sign-ins would P-5 (session
// revocation) end at deploy time? P-5 refuses a cookie whose realtimeSessionId
// is revoked in ChatRealtimeSession. Revocations so far come from sign-out
// (the browser dropped that cookie -- no effect) and from the D-3 triggers
// (account deleted, external access revoked, Google test mode off), which
// revoke every session of the member at one instant. Rows still inside their
// cookie lifetime are what matters. No ids, e-mails or names are printed.
//   node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/session-impact-check.mjs
import "../db/install-guard.mjs";
import { Client } from "pg";
import { pgConfig } from "../db/pgConfig.mjs";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const db = new Client(pgConfig(process.env.DIRECT_URL, { connectionTimeoutMillis: 15000 }));
await db.connect();
try {
  await db.query("BEGIN READ ONLY");
  const r = (await db.query(`
    WITH s AS (
      SELECT s.user_id, s.revoked_at, s.expires_at > (now() AT TIME ZONE 'UTC') AS live,
             count(*) OVER (PARTITION BY s.user_id, s.revoked_at) AS same_instant,
             u.deleted_at IS NOT NULL AS deleted, u.user_type::text AS user_type
        FROM "ChatRealtimeSession" s JOIN "User" u ON u.id = s.user_id)
    SELECT count(*)::int AS sessions,
           count(*) FILTER (WHERE live)::int AS live,
           count(*) FILTER (WHERE live AND revoked_at IS NULL)::int AS "liveActive",
           count(*) FILTER (WHERE live AND revoked_at IS NOT NULL)::int AS "liveRevoked",
           count(*) FILTER (WHERE live AND revoked_at IS NOT NULL AND same_instant = 1)::int AS "liveRevokedSingly_signOutLike",
           count(*) FILTER (WHERE live AND revoked_at IS NOT NULL AND same_instant > 1)::int AS "liveRevokedInBulk_triggerLike",
           count(DISTINCT user_id) FILTER (WHERE live AND revoked_at IS NOT NULL AND same_instant > 1 AND NOT deleted)::int AS "membersBulkRevokedNotDeleted",
           count(DISTINCT user_id) FILTER (WHERE live AND revoked_at IS NOT NULL AND same_instant > 1 AND NOT deleted AND user_type LIKE 'EXTERNAL%')::int AS "externalMembersBulkRevoked"
      FROM s`)).rows[0];
  await db.query("ROLLBACK");
  console.log(JSON.stringify({ target, ...r }, null, 1));
} finally {
  await db.end();
}
