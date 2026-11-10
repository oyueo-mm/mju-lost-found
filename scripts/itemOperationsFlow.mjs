import "./db/install-guard.mjs";
// Authenticated HTTP checks against local build backed ONLY by Preview.
// Creates uniquely named test fixtures; finally removes exactly those IDs.
import { parse } from "dotenv";
import { readFileSync } from "node:fs";
import { encode } from "@auth/core/jwt";
import pg from "pg";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const env = parse(readFileSync(".env.preview.local"));
assert.ok(env.DATABASE_URL?.includes("swqvlihgupranzfzjevb"));
assert.ok(env.DIRECT_URL?.includes("swqvlihgupranzfzjevb"));
const base = "http://127.0.0.1:3100";
const db = new pg.Client({ connectionString: env.DIRECT_URL });
await db.connect();
const ids = [], posts = [];
const marker = `ops-flow-${crypto.randomUUID()}`;
const checks = [];
const user = async (kind, admin = false) => {
  const row = (await db.query(`INSERT INTO "User" (email,name,nickname,is_admin,privacy_consent_version,terms_version,identity_consent_version,privacy_consent_at,terms_accepted_at,updated_at) VALUES ($1,'test',$2,$3,'2026-10-16','2026-10-04','2026-10-14',now(),now(),now()) RETURNING id,email`, [`${marker}-${kind}@mju.ac.kr`, `${marker}-${kind}`, admin])).rows[0];
  ids.push(row.id);
  const salt = "authjs.session-token";
  row.cookie = `${salt}=${await encode({ token: { userId: row.id, nickname: kind }, secret: createHash("sha256").update(env.DIRECT_URL + ":local-item-operations").digest("hex"), salt, maxAge: 3600 })}`;
  return row;
};
const call = async (actor, path, method = "GET", body) => {
  const res = await fetch(base + path, { method, headers: { ...(actor ? { Cookie: actor.cookie } : {}), "Content-Type": "application/json" }, ...(body && { body: JSON.stringify(body) }), redirect: "manual" });
  const text = await res.text(); let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, text, json };
};
try {
  const owner = await user("owner"), stranger = await user("stranger"), officer = await user("officer"), other = await user("other"), admin = await user("admin", true);
  for (const [actor, campus] of [[officer, "인문캠퍼스"], [other, "자연캠퍼스"]]) await db.query(`INSERT INTO "ExternalAccessGrant" (email,name,affiliation,campus,created_by_user_id,can_manage_items,updated_at) VALUES ($1,'test',$2,$3,$4,true,now())`, [actor.email, marker, campus, admin.id]);
  await db.query(`INSERT INTO "UserIdentityInfo" (user_id,real_name,department,consent_version,consented_at,updated_at) VALUES ($1,'테스트','테스트','2026-10-14',now(),now())`, [owner.id]);
  const create = await call(owner, "/api/posts", "POST", { type: "found", title: marker, description: "Preview test fixture", category: "기타", location: null, campus: "인문캠퍼스", foundDate: null, foundTime: null, custody: { state: "PLANNED", place: "국제관 경비실" } });
  assert.equal(create.status, 201, `create: ${create.status} ${create.text.slice(0, 200)}`);
  const id = create.json.data.id; posts.push(id); const path = `/api/posts/${id}?type=found`;
  let item = create.json.data;
  assert.equal(item.custody.confirmedAt, null); checks.push("registration preserves unconfirmed planned custody");
  const management = (action, more = {}) => ({ management: { action, expectedUpdatedAt: item.updatedAt, confirmed: true, ...more } });
  assert.equal((await call(stranger, path, "PATCH", { status: "완료" })).status, 403);
  assert.equal((await call(stranger, path, "PATCH", management("complete"))).status, 403);
  assert.equal((await call(other, path, "PATCH", management("confirm", { place: "test" }))).status, 403); checks.push("ordinary user and campus boundaries enforced");
  assert.equal((await call(officer, path, "PATCH", management("complete"))).status, 403);
  assert.equal((await call(officer, path, "PATCH", { title: "forged" })).status, 403);
  assert.equal((await call(officer, path, "DELETE")).status, 403); checks.push("special role cannot edit content, delete, or return before receipt");
  assert.equal((await call(officer, path, "PATCH", management("confirm", { place: "국제관 경비실" }))).status, 200);
  assert.equal((await call(officer, path, "PATCH", management("confirm", { place: "국제관 경비실" }))).status, 409);
  item = (await call(owner, path)).json.data;
  assert.ok(item.custody.confirmedAt); assert.equal(item.custody.confirmedBy, null); checks.push("receipt confirmation, reviewer privacy and stale-write rejection");
  const html = await call(officer, `/post/${id}?type=found`);
  assert.equal(html.status, 200); assert.ok(html.text.includes("물품 접수·반환 관리")); assert.ok(html.text.includes("확인 완료"));
  const publicHtml = await call(stranger, `/post/${id}?type=found`);
  assert.equal(publicHtml.status, 200); assert.ok(!publicHtml.text.includes("물품 접수·반환 관리")); checks.push("detail UI respects role and shows custody");
  assert.equal((await call(owner, path, "PATCH", { custody: { state: "SELF", place: "", confirmedAt: new Date().toISOString() } })).status, 400);
  assert.equal((await call(owner, path, "PATCH", { custody: { state: "SELF", place: "" } })).status, 200);
  item = (await call(owner, path)).json.data;
  assert.equal(item.custody.confirmedAt, null); checks.push("owner cannot forge verification and location changes invalidate it");
  assert.equal((await call(officer, path, "PATCH", management("confirm", { place: "국제관 경비실" }))).status, 200);
  item = (await call(owner, path)).json.data;
  assert.equal((await call(officer, path, "PATCH", management("complete"))).status, 200);
  item = (await call(owner, path)).json.data; assert.equal(item.status, "완료");
  assert.equal((await call(officer, path, "PATCH", management("reopen"))).status, 403);
  assert.equal((await call(admin, path, "PATCH", management("reopen"))).status, 200); checks.push("confirmed return and platform-only recovery");
  assert.equal((await call(owner, path, "PATCH", { status: "완료" })).status, 200); checks.push("existing owner completion preserved");
  const audit = (await db.query('SELECT activity_audience,action FROM "PostStatusChange" WHERE post_type=\'found\' AND post_id=$1 ORDER BY id', [id])).rows;
  assert.ok(audit.some((r) => r.action === "complete" && r.activity_audience === "internal"));
  assert.ok(audit.some((r) => r.action === "owner_status" && r.activity_audience === "member"));
  assert.equal((await db.query('SELECT activity_audience FROM "FoundPost" WHERE id=$1', [id])).rows[0].activity_audience, "member");
  assert.ok(Number((await db.query('SELECT count(*) AS n FROM "Notification" WHERE user_id=$1 AND type=\'post_managed\'', [owner.id])).rows[0].n) >= 4); checks.push("actor/source attribution, audit and author notifications");
  for (const tab of ["ops", "users", "admins"]) {
    const stats = await call(admin, `/admin/stats?tab=${tab}&period=week`);
    assert.equal(stats.status, 200, `stats ${tab}: ${stats.status}`);
    assert.ok(stats.text.includes("최근 7일"));
  }
  checks.push("all three statistics tabs render with rolling-period queries");
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  // Clean up only IDs created above, never existing Preview content.
  await db.query('DELETE FROM "PostStatusChange" WHERE changed_by_user_id = ANY($1::int[])', [ids]);
  await db.query('DELETE FROM "Notification" WHERE user_id = ANY($1::int[])', [ids]);
  await db.query('DELETE FROM "FoundPost" WHERE id = ANY($1::int[])', [posts]);
  await db.query('DELETE FROM "ExternalAccessGrant" WHERE created_by_user_id = ANY($1::int[])', [ids]);
  await db.query('DELETE FROM "AdminVisit" WHERE admin_user_id = ANY($1::int[])', [ids]);
  await db.query('DELETE FROM "AdminActivityLog" WHERE admin_user_id = ANY($1::int[])', [ids]);
  await db.query('DELETE FROM "User" WHERE id = ANY($1::int[])', [ids]);
  await db.end();
}
