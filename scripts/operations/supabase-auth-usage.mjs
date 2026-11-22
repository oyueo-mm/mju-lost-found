// Security audit A-2: is Supabase Auth (GoTrue) used at all? Counts only --
// never emails, ids, metadata or tokens. Read-only transaction.
//
//   node --env-file=.env.preview.local scripts/operations/supabase-auth-usage.mjs
//   node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/supabase-auth-usage.mjs
//
// MJU Find signs in with Auth.js (Google) and mints its own Realtime JWTs, so
// every count here is expected to be 0. A non-zero users count means someone
// registered through the open email signup; investigate before disabling it.
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";

const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const db = new Client(pgConfig(process.env.DIRECT_URL, { connectionTimeoutMillis: 15000 }));
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const one = async (sql) => (await db.query(sql)).rows[0];
  const users = await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE email_confirmed_at IS NOT NULL)::int AS confirmed,
    to_char(max(created_at) AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD') AS last_created_kst_day FROM auth.users`);
  const providers = (await db.query(`SELECT provider, count(*)::int AS n FROM auth.identities GROUP BY provider ORDER BY provider`)).rows;
  const sessions = await one(`SELECT count(*)::int AS n FROM auth.sessions`);
  const refresh = await one(`SELECT count(*)::int AS n FROM auth.refresh_tokens`);
  await db.query("ROLLBACK");
  console.log(JSON.stringify({ target, readOnly: true, authUsers: users, identitiesByProvider: providers, sessions: sessions.n, refreshTokens: refresh.n }));
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  console.error("auth usage read failed:", error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await db.end();
}
