import "./db/install-guard.mjs";
// Preview-only migration / rollback-only integration tests. No Production
// credentials are passed to a child process. No test rows are committed.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";
import pg from "pg";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const preview = parse(readFileSync(".env.preview.local"));
const production = parse(readFileSync(".env"));
const REF = "swqvlihgupranzfzjevb";
for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
  assert.ok(preview[key]?.includes(REF), `Refusing: ${key} is not the Preview project`);
  assert.notEqual(preview[key], production[key], "Refusing: Preview and Production match");
  assert.ok(!preview[key].includes("tmifqtyxojtuoejxjrng"));
}
if (process.argv[2] === "migrate") {
  const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "migrate", "deploy", "--config", "prisma7.config.ts"], {
    env: { ...process.env, ...preview, VERCEL_ENV: "preview" }, stdio: "inherit", shell: process.platform === "win32",
  });
  process.exit(result.status ?? 1);
}
if (["build", "serve"].includes(process.argv[2])) {
  const result = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", ...(process.argv[2] === "build" ? ["build"] : ["start", "--hostname", "127.0.0.1", "--port", "3100"])], {
    env: { ...process.env, ...preview, VERCEL_ENV: "preview", AUTH_URL: "http://127.0.0.1:3100", AUTH_TRUST_HOST: "true", AUTH_SECRET: createHash("sha256").update(preview.DIRECT_URL + ":local-item-operations").digest("hex") }, stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}
assert.equal(process.argv[2], "test", "usage: itemOperationsPreview.mjs migrate|test");
const db = new pg.Client({ connectionString: preview.DIRECT_URL });
await db.connect();
try {
  await db.query("BEGIN");
  const makeUser = async (tag, admin = false) => (await db.query(`INSERT INTO "User" (email,name,is_admin,updated_at) VALUES ($1,'operations-test',$2,now()) RETURNING id,activity_audience`, [`operations-${tag}-${crypto.randomUUID()}@example.org`, admin])).rows[0];
  const owner = await makeUser("owner"), officer = await makeUser("officer"), admin = await makeUser("admin", true);
  assert.equal(owner.activity_audience, "member"); assert.equal(admin.activity_audience, "internal");
  const email = (await db.query('SELECT email FROM "User" WHERE id=$1', [officer.id])).rows[0].email;
  await db.query(`INSERT INTO "ExternalAccessGrant" (email,name,affiliation,campus,created_by_user_id,can_manage_items,updated_at) VALUES ($1,'guard','Test institution','인문캠퍼스',$2,true,now())`, [email, admin.id]);
  const makePost = async (actor) => (await db.query(`INSERT INTO "FoundPost" (user_id,title,description,category,updated_at) VALUES ($1,'rollback integration test','test','기타',now()) RETURNING id,activity_audience,custody`, [actor])).rows[0];
  const item = await makePost(owner.id), staffItem = await makePost(officer.id);
  assert.equal(item.activity_audience, "member"); assert.equal(item.custody, null); assert.equal(staffItem.activity_audience, "internal");
  await db.query(`UPDATE "User" SET is_admin=true WHERE id=$1`, [owner.id]);
  const afterPromotion = await makePost(owner.id);
  assert.equal(afterPromotion.activity_audience, "internal");
  assert.equal((await db.query('SELECT activity_audience FROM "FoundPost" WHERE id=$1', [item.id])).rows[0].activity_audience, "member");
  await db.query(`UPDATE "FoundPost" SET activity_audience='internal' WHERE id=$1`, [item.id]);
  assert.equal((await db.query('SELECT activity_audience FROM "FoundPost" WHERE id=$1', [item.id])).rows[0].activity_audience, "member");
  await db.query(`INSERT INTO "PostStatusChange" (post_type,post_id,from_status,to_status,changed_by_user_id,action,institution) VALUES ('found',$1,'보관 중','완료',$2,'complete','Test institution')`, [item.id, officer.id]);
  const change = (await db.query('SELECT activity_audience FROM "PostStatusChange" WHERE post_id=$1 AND changed_by_user_id=$2', [item.id, officer.id])).rows[0];
  assert.equal(change.activity_audience, "internal");
  // Revocation affects future classification, never the recorded action.
  await db.query(`UPDATE "ExternalAccessGrant" SET status='revoked' WHERE email=$1`, [email]);
  assert.equal((await makePost(officer.id)).activity_audience, "member");
  assert.equal((await db.query('SELECT activity_audience FROM "PostStatusChange" WHERE post_id=$1 AND changed_by_user_id=$2', [item.id, officer.id])).rows[0].activity_audience, "internal");
  const day = "2026-11-02";
  await db.query(`INSERT INTO "MetricDaily" (day,metric,value) VALUES ($1::date,'visit.page.test.member',999),($1::date,'audience_v2.visit.page.test.member',3)`, [day]);
  const classified = await db.query(`SELECT sum(value)::int AS n FROM "OperationalMetricDaily" WHERE day=$1::date AND metric='visit.page.test.member'`, [day]);
  assert.equal(classified.rows[0].n, 3);
  const org = (await db.query(`INSERT INTO "Organization" (name,organization_type,updated_at) VALUES ('rollback integration test','test',now()) RETURNING id`)).rows[0];
  await db.query(`INSERT INTO "OrganizationMember" (organization_id,user_id,role) VALUES ($1,$2,'admin')`, [org.id, officer.id]);
  assert.equal((await makePost(officer.id)).activity_audience, "internal");
  console.log("PASS: Preview DB audience triggers, role changes, immutable history, source/actor separation, legacy custody, approval revocation; all test rows rolled back.");
} finally {
  await db.query("ROLLBACK");
  await db.end();
}
