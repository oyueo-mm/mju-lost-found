// Inspect authorization decisions and provider ACLs without returning identities.
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment, assertScriptSupabaseAccess } from "../../src/lib/db/accessPolicy.mjs";

const [confirmation, ...extra] = process.argv.slice(2);
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
if (extra.length || !["production", "preview"].includes(target) || confirmation !== `--confirm-${target}` || assertScriptSupabaseAccess(process.env) !== target) {
  throw new Error("Explicit matching hosted targets required");
}

const db = new Client({ connectionString: process.env.DIRECT_URL, statement_timeout: 5000 });
try {
  await db.connect();
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const { rows: [membership] } = await db.query(`
    WITH rooms AS (
      SELECT id, initiator_user_id, counterpart_user_id, organization_id
      FROM public."ChatRoom" ORDER BY id LIMIT 8
    ), members AS (
      SELECT r.id AS room_id, u.id AS user_id
      FROM rooms r JOIN public."User" u ON u.id = r.initiator_user_id
      WHERE u.deleted_at IS NULL AND upper(u.user_type::text) = 'STUDENT'
    ), outsiders AS (
      SELECT r.id AS room_id, u.id AS user_id FROM rooms r
      CROSS JOIN LATERAL (
        SELECT u.id FROM public."User" u
        WHERE u.deleted_at IS NULL AND upper(u.user_type::text) = 'STUDENT'
          AND u.id IS DISTINCT FROM r.initiator_user_id AND u.id IS DISTINCT FROM r.counterpart_user_id
          AND NOT EXISTS (
            SELECT 1 FROM public."OrganizationMember" m
            WHERE m.organization_id = r.organization_id AND m.user_id = u.id
          )
        ORDER BY u.id LIMIT 1
      ) u
    )
    SELECT (SELECT count(*)::int FROM members) AS member_samples,
           (SELECT count(*)::int FROM members WHERE public.mju_chat_member_allowed(user_id, room_id)) AS members_allowed,
           (SELECT count(*)::int FROM outsiders) AS outsider_samples,
           (SELECT count(*)::int FROM outsiders WHERE NOT public.mju_chat_member_allowed(user_id, room_id)) AS outsiders_denied
  `);
  const { rows: roleAccess } = await db.query(`
    SELECT rolname AS role, rolbypassrls AS bypass_rls,
           has_schema_privilege(rolname, 'realtime', 'USAGE') AS schema_usage,
           has_table_privilege(rolname, 'realtime.messages', 'SELECT') AS can_select,
           has_table_privilege(rolname, 'realtime.messages', 'INSERT') AS can_insert
    FROM pg_roles WHERE rolname IN ('anon', 'mju_chat_realtime', 'service_role') ORDER BY rolname
  `);
  await db.query("ROLLBACK");
  console.log(JSON.stringify({ target, readOnly: true, membership, roleAccess }));
  if (membership.member_samples !== membership.members_allowed || membership.outsider_samples !== membership.outsiders_denied) process.exitCode = 1;
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  console.error("Realtime access control stopped:", error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await db.end();
}
