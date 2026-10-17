// Read-only check of one account's 이름·소속 state on the Preview DB, for the
// real-account test (log in -> 개인정보 동의 -> automatic save -> sign in again).
// Prints no name, affiliation or full e-mail -- only whether things are there.
//
//   node --env-file=.env.preview.local scripts/check-identity-state.mjs <email>
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const email = process.argv[2]?.trim().toLowerCase();
if (!email) throw new Error("usage: check-identity-state.mjs <email>");
if (!process.env.DIRECT_URL?.includes("postgres.swqvli")) throw new Error("Preview DB only");

const db = new Client({ connectionString: process.env.DIRECT_URL });
await db.connect();
try {
  // Read-only per transaction, never per session: a session setting can stay
  // on a pooled server connection and reach the app (Supabase pooler).
  await db.query("BEGIN READ ONLY");
  const { rows: [user] } = await db.query(
    `SELECT u.id, u.privacy_consent_version, u.privacy_consent_at, u.identity_consent_version, u.identity_consent_at, u.last_login_at,
            i.user_id IS NOT NULL AS has_row, i.real_name_source, i.department_source, i.consent_version, i.consented_at, i.updated_at,
            length(i.real_name) AS name_len, length(i.department) AS dept_len
       FROM "User" u LEFT JOIN "UserIdentityInfo" i ON i.user_id = u.id
      WHERE lower(u.email) = $1 AND u.deleted_at IS NULL`,
    [email],
  );
  const masked = email.replace(/^(.).*(@.*)$/, "$1***$2");
  if (!user) {
    console.log(`${masked}: no active account (a first sign-in will create one)`);
  } else {
    const fmt = (d) => (d ? new Date(d).toISOString() : "-");
    console.log(`account ${masked} (id ${user.id})`);
    console.log(`  개인정보 동의 버전  ${user.privacy_consent_version ?? "-"}  (${fmt(user.privacy_consent_at)})`);
    console.log(`  이름·소속 동의 버전 ${user.identity_consent_version ?? "-"}  (${fmt(user.identity_consent_at)})`);
    console.log(`  최근 로그인         ${fmt(user.last_login_at)}`);
    console.log(
      user.has_row
        ? `  이름·소속 저장됨: 출처 ${user.real_name_source}/${user.department_source}, 길이 ${user.name_len}/${user.dept_len}자, 행 동의 버전 ${user.consent_version}, 수정 ${fmt(user.updated_at)}`
        : "  이름·소속 저장 안 됨",
    );
    const { rows: [logs] } = await db.query(`SELECT count(*)::int AS n FROM "IdentityAccessLog" WHERE target_user_id = $1`, [user.id]);
    console.log(`  관리자 열람 기록    ${logs.n}건`);
  }
  await db.query("COMMIT");
} finally {
  await db.end();
}
