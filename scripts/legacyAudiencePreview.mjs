// Scenario test of the legacy-audience DB functions (migration
// 20261111000000_legacy_audience_evidence) on the Preview DB. Everything runs in
// ONE transaction that is always rolled back: no fixture is left behind.
//   node scripts/legacyAudiencePreview.mjs
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import pg from "pg";
import assert from "node:assert/strict";

const env = parse(readFileSync(".env.preview.local"));
assert.ok(env.DIRECT_URL?.includes("swqvlihgupranzfzjevb"), "Preview DB only");
const db = new pg.Client({ connectionString: env.DIRECT_URL });
await db.connect();
const results = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(ok);
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
};
try {
  await db.query("BEGIN");
  const marker = `legacy-test-${Date.now()}`;
  const mk = async (kind, created, extra = {}) => (await db.query(
    `INSERT INTO "User" (email, name, nickname, is_admin, user_type, created_at, updated_at) VALUES ($1, 't', $2, $3, $4::"UserType", $5::timestamp, now()) RETURNING id`,
    [`${marker}-${kind}@mju.ac.kr`, kind.slice(0, 20), Boolean(extra.admin), extra.type ?? "student", created])).rows[0].id;
  const boot = await mk("boot", "2026-10-01 00:00", { admin: true }); // bootstrapped admin, no grant record
  const promoted = await mk("promoted", "2026-10-02 00:00", { admin: true }); // granted 10-10
  const flip = await mk("flip", "2026-10-02 00:00"); // granted 10-05, revoked 10-08
  const member = await mk("member", "2026-10-03 00:00");
  const tester = await mk("tester", "2026-10-03 00:00", { type: "external_test" });
  const event = async (target, type, at) => {
    const p = (await db.query(`INSERT INTO "AdminActionProposal" (target_user_id, action_type, proposed_by_user_id, created_at, expires_at, executed_at) VALUES ($1, $2::"AdminActionProposalType", $3, $4::timestamp, $4::timestamp + interval '1 day', $4::timestamp) RETURNING id`, [target, type, boot, at])).rows[0].id;
    await db.query(`INSERT INTO "AdminActionAuditLog" (proposal_id, event, actor_user_id, created_at) VALUES ($1, 'executed'::"AdminActionAuditEvent", $2, $3::timestamp)`, [p, boot, at]);
  };
  // boot's first recorded administrative act is proposing the grant below (10-05 03:00 UTC)
  await event(flip, "grant_admin", "2026-10-05 03:00");
  await event(flip, "revoke_admin", "2026-10-08 03:00");
  await event(promoted, "grant_admin", "2026-10-10 03:00");
  const f = async (sql, ...p) => (await db.query(sql, p)).rows[0].v;
  const aud = (id, at) => f(`SELECT mju_legacy_audience($1, $2::timestamp) v`, id, at);
  const day = (id, d) => f(`SELECT mju_legacy_day_audience($1, $2::date) v`, id, d);

  check("member: always a member", [await aud(member, "2026-10-04 00:00"), await aud(member, "2026-10-30 00:00")], ["member", "member"]);
  check("promoted: member before the executed grant, admin after", [await aud(promoted, "2026-10-09 00:00"), await aud(promoted, "2026-10-11 00:00")], ["member", "internal"]);
  check("flip: member, admin while granted, member again after the revoke", [await aud(flip, "2026-10-04 00:00"), await aud(flip, "2026-10-06 00:00"), await aud(flip, "2026-10-09 00:00")], ["member", "internal", "member"]);
  check("bootstrapped admin: unknown before its first recorded admin act, admin after", [await aud(boot, "2026-10-02 00:00"), await aud(boot, "2026-10-06 00:00")], ["unclassified", "internal"]);
  check("test-mode account is never a member", await aud(tester, "2026-10-04 00:00"), "unclassified");
  check("unknown account is unclassified", await aud(-1, "2026-10-04 00:00"), "unclassified");
  check("role mapping", [await f(`SELECT mju_legacy_role($1, '2026-10-11'::timestamp) v`, promoted), await f(`SELECT mju_legacy_role($1, '2026-10-09'::timestamp) v`, promoted)], ["service", "member"]);
  check("sign-up of a later admin is a member sign-up; a test-mode sign-up is not",
    [await f(`SELECT mju_legacy_signup_audience($1) v`, promoted), await f(`SELECT mju_legacy_signup_audience($1) v`, boot), await f(`SELECT mju_legacy_signup_audience($1) v`, tester)],
    ["member", "member", "unclassified"]);
  // KST day 10-10 = UTC 10-09 15:00 .. 10-10 15:00; the grant at 03:00 UTC falls inside it
  check("day of a promotion is unclassified; whole days on either side are not",
    [await day(promoted, "2026-10-09"), await day(promoted, "2026-10-10"), await day(promoted, "2026-10-11")], ["member", "unclassified", "internal"]);
  // a stored snapshot always wins over the evidence (COALESCE in the app)
  const post = (await db.query(`INSERT INTO "LostPost" (user_id, title, description, category, campus, updated_at) VALUES ($1, 't', 't', '기타', '자연캠퍼스', now()) RETURNING id, activity_audience`, [promoted])).rows[0];
  check("new rows are still stamped by the trigger (not left to the legacy rule)", post.activity_audience, "internal");
  // the view: pre-snapshot counters back, same-name rows of one day added, markers on their own day
  const snap = (await db.query(`SELECT min(day)::text d FROM "MetricDaily" WHERE metric = 'meta.since.audience_snapshot'`)).rows[0].d;
  await db.query(`INSERT INTO "MetricDaily" (day, metric, value) VALUES ($1::date - 1, 'visit.pv.member', 7), ($1::date, 'visit.pv.member', 1), ($1::date, 'audience_v3.visit.pv.member', 2), ($1::date + 1, 'visit.pv.member', 50) ON CONFLICT (day, metric) DO UPDATE SET value = "MetricDaily".value + EXCLUDED.value RETURNING 1`, [snap]);
  const v = (await db.query(`SELECT day::text, value FROM "OperationalMetricDaily" WHERE metric = 'visit.pv.member' AND day BETWEEN $1::date - 1 AND $1::date + 1 ORDER BY day`, [snap])).rows;
  const before = v.find((r) => r.day < snap)?.value ?? 0, on = v.find((r) => r.day === snap)?.value ?? 0, after = v.find((r) => r.day > snap)?.value ?? 0;
  check("view: pre-snapshot counter read again", before >= 7, true);
  check("view: v1 and v3 rows of the snapshot day added", on >= 3, true);
  check("view: an unprefixed counter after the snapshot day is not read (no double source)", after < 50, true);
} finally {
  await db.query("ROLLBACK");
  await db.end();
}
console.log(results.every(Boolean) ? `ALL ${results.length} DB CHECKS PASSED (rolled back)` : `FAILED ${results.filter((r) => !r).length}/${results.length}`);
process.exitCode = results.every(Boolean) ? 0 : 1;
