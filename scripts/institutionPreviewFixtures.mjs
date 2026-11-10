import "./db/install-guard.mjs";
// Preview-only fixtures for HTTP and browser verification. No real account
// is edited. Secrets/cookies are kept in ignored .vercel files, never output.
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";
import { encode } from "@auth/core/jwt";
import pg from "pg";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
const preview = parse(readFileSync(".env.preview.local"));
assert.ok(preview.DATABASE_URL?.includes("swqvlihgupranzfzjevb"));
assert.ok(preview.DIRECT_URL?.includes("swqvlihgupranzfzjevb"));
const file = ".vercel/institution-fixtures.json";
const db = new pg.Client({ connectionString: preview.DIRECT_URL }); await db.connect();
try {
  if (process.argv[2] === "setup") {
    const marker = `institution-test-${crypto.randomUUID()}`;
    const local = parse(readFileSync(".env"));
    const secret = local.AUTH_SECRET ?? local.NEXTAUTH_SECRET;
    assert.ok(secret && secret !== "[SENSITIVE]");
    const data = { marker, users: {}, organizations: [], posts: [], lostPosts: [] };
    writeFileSync(file, JSON.stringify(data));
    for (const kind of ["owner", "officerA", "officerB", "newOfficer", "orgAdmin", "external", "service", "dual"]) {
      const email = `${marker}-${kind}@${kind === "external" ? "example.org" : "mju.ac.kr"}`;
      const row = (await db.query(`INSERT INTO "User" (email,name,nickname,is_admin,user_type,privacy_consent_version,identity_consent_version,terms_version,privacy_consent_at,terms_accepted_at,updated_at) VALUES ($1,'Preview test',$2,$3,$4::"UserType",'2026-10-16','2026-10-14','2026-10-04',now(),now(),now()) RETURNING id,email,public_id`, [email, `검증 ${kind}`, ["service", "dual"].includes(kind), kind === "external" ? "external_verified" : "student"])).rows[0];
      data.users[kind] = { ...row, cookie: await encode({ token: { userId: row.id, nickname: `검증 ${kind}` }, secret, salt: "__Secure-authjs.session-token", maxAge: 7200 }) };
      writeFileSync(file, JSON.stringify(data));
      await db.query(`INSERT INTO "UserIdentityInfo" (user_id,real_name,department,consent_version,consented_at,updated_at) VALUES ($1,'테스트','테스트 기관','2026-10-14',now(),now())`, [row.id]);
    }
    for (const [name, campus] of [["A 경비실", "인문캠퍼스"], ["B 학생지원팀", "자연캠퍼스"]]) {
      const row = (await db.query(`INSERT INTO "Organization" (name,organization_type,scope,management_campus,updated_at) VALUES ($1,'검증용 관리 기관',$2,$2,now()) RETURNING id,name`, [`${marker} ${name}`, campus])).rows[0];
      data.organizations.push(row); writeFileSync(file, JSON.stringify(data));
    }
    for (const [key, index] of [["officerA", 0], ["officerB", 1], ["dual", 0]]) await db.query(`INSERT INTO "InstitutionOfficer" (user_id,organization_id,facility,granted_by_user_id,updated_at) VALUES ($1,$2,'검증 시설',$3,now())`, [data.users[key].id, data.organizations[index].id, data.users.service.id]);
    await db.query(`INSERT INTO "OrganizationMember" (organization_id,user_id,role) VALUES ($1,$2,'admin')`, [data.organizations[0].id, data.users.orgAdmin.id]);
    await db.query(`INSERT INTO "ExternalAccessGrant" (email,name,affiliation,campus,created_by_user_id,updated_at) VALUES ($1,'검증용 외부 계정','로그인만 승인','양쪽',$2,now())`, [data.users.external.email, data.users.service.id]);
    for (let i = 0; i < 3; i++) {
      const row = (await db.query(`INSERT INTO "FoundPost" (user_id,title,description,category,category_code,campus,updated_at,custody) VALUES ($1,$2,'Preview 기관 운영 검증','기타','etc','자연캠퍼스',now(),$3::jsonb) RETURNING id`, [data.users.owner.id, `${marker} 물품 ${i}`, JSON.stringify({ state: "PLANNED", place: "실제 접수와 다른 예정 장소" })])).rows[0];
      data.posts.push(row.id); writeFileSync(file, JSON.stringify(data));
    }
    console.log("Preview fixtures created. Test identities and session cookies stored only in ignored .vercel/institution-fixtures.json.");
  } else if (process.argv[2] === "trigger-test") {
    await db.query("BEGIN");
    const actor = `fixture-${crypto.randomUUID()}`;
    const row = (await db.query('INSERT INTO "ActivityDay" (day,actor,activity_role) VALUES (CURRENT_DATE,$1,\'officer\') RETURNING activity_role,activity_audience', [actor])).rows[0];
    assert.equal(row.activity_role, "officer"); assert.equal(row.activity_audience, "internal");
    const updated = (await db.query('UPDATE "ActivityDay" SET activity_role=\'member\' WHERE actor=$1 RETURNING activity_role,activity_audience', [actor])).rows[0];
    assert.deepEqual(updated,row);
    await db.query("ROLLBACK");
    console.log("Preview DB integration passed: anonymous activity marks retain server role and updates cannot rewrite snapshots. Test transaction rolled back.");
  } else if (process.argv[2] === "refresh") {
    const data = JSON.parse(readFileSync(file));
    const env = parse(readFileSync(".env"));
    for (const [key, user] of Object.entries(data.users)) user.cookie = await encode({ token: { userId: user.id, nickname: `검증 ${key}` }, secret: env.AUTH_SECRET ?? env.NEXTAUTH_SECRET, salt: "__Secure-authjs.session-token", maxAge: 7200 });
    writeFileSync(file, JSON.stringify(data)); console.log("Refreshed only the temporary Preview test sessions. No account data changed.");
  } else if (process.argv[2] === "validate") {
    const data = JSON.parse(readFileSync(file));
    const grant = (await db.query('SELECT active FROM "InstitutionOfficer" WHERE user_id=$1', [data.users.newOfficer.id])).rows[0];
    const users = (await db.query('SELECT is_admin,activity_role FROM "User" WHERE id=$1', [data.users.newOfficer.id])).rows[0];
    const posts = (await db.query('SELECT user_id,activity_role,activity_organization_id FROM "FoundPost" WHERE user_id=ANY($1::int[]) ORDER BY id', [[data.users.officerA.id,data.users.dual.id,data.users.newOfficer.id]])).rows;
    const audit = (await db.query('SELECT action,activity_role,organization_id FROM "PostStatusChange" WHERE post_id=$1 ORDER BY id', [data.posts[0]])).rows;
    assert.equal(grant?.active, false, "The browser must revoke the test grant");
    assert.equal(users?.is_admin, false, "Officer assignment must never grant service administration");
    assert.equal(users?.activity_role, "member", "Assignment must preserve signup-time classification");
    for (const [key, role] of [["officerA", "officer"], ["dual", "service"], ["newOfficer", "member"]]) {
      assert.ok(posts.some((p) => p.user_id === data.users[key].id && p.activity_role === role), `${key}: event-time post role`);
    }
    assert.equal(audit.filter((a) => a.action === "transfer_accept").length, 1);
    assert.equal(audit.find((a) => a.action === "reopen")?.activity_role, "service");
    const traffic = (await db.query('SELECT metric,sum(value)::int AS n FROM "MetricDaily" WHERE metric LIKE $1 GROUP BY metric', [`audience_v3.role.%.org.${data.organizations[0].id}.%`])).rows;
    for (const role of ["service", "officer"]) assert.ok(traffic.some((r) => r.metric === `audience_v3.role.${role}.org.${data.organizations[0].id}.visit.internal.pv` && r.n > 0), `${role}: real Preview page views`);
    console.log("Preview traffic snapshots verified for officer and service-precedence dual-role page views.");
    console.log(JSON.stringify({ revoked: grant?.active === false, servicePrivilegeNotGranted: users?.is_admin === false, signupRolePreserved: users?.activity_role === 'member', postSnapshots: posts.map((p) => ({ actor: Object.keys(data.users).find((k) => data.users[k].id === p.user_id), role:p.activity_role, organizationId:p.activity_organization_id })), itemActions: audit.map((a) => ({ action:a.action,role:a.activity_role,organizationId:a.organization_id })) },null,2));
  } else if (process.argv[2] === "cleanup") {
    const data = JSON.parse(readFileSync(file));
    const ids = Object.values(data.users).map((u) => u.id), orgs = data.organizations.map((o) => o.id);
    assert.ok(data.marker.startsWith("institution-test-"));
    const existing = (await db.query('SELECT email FROM "User" WHERE id=ANY($1::int[])', [ids])).rows;
    assert.ok(existing.every((u) => u.email.startsWith(data.marker + "-")), "Refusing to delete a non-fixture account");
    await db.query("BEGIN");
    const local = parse(readFileSync(".env"));
    const actors = ids.map((id) => createHmac("sha256", `activity-day:v1:${local.AUTH_SECRET ?? ""}`).update(String(id)).digest("base64url").slice(0, 22));
    await db.query('DELETE FROM "ActivityDay" WHERE actor=ANY($1::text[])', [actors]);
    await db.query('DELETE FROM "Notification" WHERE user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "PostStatusChange" WHERE changed_by_user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "InstitutionOfficerAudit" WHERE actor_user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "InstitutionOfficer" WHERE user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "ChatRoom" WHERE initiator_user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "FoundPost" WHERE user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "LostPost" WHERE user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "OrganizationMember" WHERE user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "ExternalAccessGrant" WHERE created_by_user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "AdminVisit" WHERE admin_user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "AdminActivityLog" WHERE admin_user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "Organization" WHERE id=ANY($1::int[])', [orgs]);
    await db.query('DELETE FROM "User" WHERE id=ANY($1::int[])', [ids]);
    await db.query("COMMIT");
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "User" WHERE id=ANY($1::int[])', [ids])).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "Organization" WHERE id=ANY($1::int[])', [orgs])).rows[0].n, 0);
    console.log("Only the explicitly created Preview fixtures were removed; zero test accounts and institutions remain.");
  } else throw new Error("usage: institutionPreviewFixtures.mjs setup|refresh|trigger-test|validate|cleanup");
} finally { await db.end(); }
