// Preview-only fixtures + HTTP checks for the per-user admin permissions.
// Creates throw-away accounts/agencies/posts (never touches a real account) and
// keeps their session cookies in the git-ignored .vercel folder. Usage:
//   node scripts/adminPermissionsPreview.mjs setup | http | validate | cleanup
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";
import { encode } from "@auth/core/jwt";
import pg from "pg";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const preview = parse(readFileSync(".env.preview.local"));
assert.ok(preview.DIRECT_URL?.includes("swqvlihgupranzfzjevb"), "not the Preview DB");
assert.ok(!preview.DIRECT_URL.includes("tmifqtyxojtuoejxjrng"), "Production DB refused");
const file = ".vercel/permission-fixtures.json";
const BASE = "https://mju-lost-found-preview.vercel.app";
const db = new pg.Client({ connectionString: preview.DIRECT_URL });
await db.connect();

const KINDS = {
  super: { admin: true },
  subject: {}, plain: {}, stranger: {},
  returnOnly: { grants: ["items.return"], scope: 0 },
  receiveOnly: { grants: ["items.receive"], scope: 0 },
  restoreOnly: { grants: ["items.restore"], scope: 0 },
  reportsView: { grants: ["reports.view"] },
  reportsProcess: { grants: ["reports.view", "reports.process"] },
  statsOps: { grants: ["stats.operations"] },
  statsUsers: { grants: ["stats.users"] },
  statsAdmins: { grants: ["stats.admins"] },
  usersView: { grants: ["users.view"] },
  usersSanction: { grants: ["users.view", "users.sanction"] },
  institutions: { grants: ["institutions.manage"] },
  external: { grants: ["access.external"] },
  promo: { grants: ["promotion.manage"] },
};

async function cookieFor(user, secret) {
  return encode({ token: { userId: user.id, nickname: `검증 ${user.kind}` }, secret, salt: "__Secure-authjs.session-token", maxAge: 7200 });
}
async function bypassHeaders() {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("npx", ["vercel", "api", "/v9/projects/prj_zMYrrsw80l829lSjs2n2Ur6YV5eP", "--scope", "oyueo"], { encoding: "utf8", shell: true, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  const key = Object.keys(JSON.parse(out.slice(out.indexOf("{"))).protectionBypass ?? {})[0];
  return { "x-vercel-protection-bypass": key };
}

try {
  if (process.argv[2] === "setup") {
    const marker = `permission-test-${crypto.randomUUID()}`;
    const local = parse(readFileSync(".env"));
    const secret = local.AUTH_SECRET ?? local.NEXTAUTH_SECRET;
    assert.ok(secret && secret !== "[SENSITIVE]");
    const data = { marker, users: {}, organizations: [], posts: [] };
    writeFileSync(file, JSON.stringify(data));
    for (const [i, name] of ["A 경비실", "B 학생지원팀"].entries()) {
      const row = (await db.query(`INSERT INTO "Organization" (name,organization_type,scope,management_campus,updated_at) VALUES ($1,'검증용 관리 기관','양쪽','양쪽',now()) RETURNING id,name`, [`${marker} ${name}`])).rows[0];
      data.organizations[i] = row; writeFileSync(file, JSON.stringify(data));
    }
    for (const [kind, spec] of Object.entries(KINDS)) {
      const email = `${marker}-${kind}@mju.ac.kr`;
      const row = (await db.query(`INSERT INTO "User" (email,name,nickname,is_admin,user_type,privacy_consent_version,identity_consent_version,terms_version,privacy_consent_at,terms_accepted_at,updated_at) VALUES ($1,'Preview test',$2,$3,'student'::"UserType",'2026-10-16','2026-10-14','2026-10-04',now(),now(),now()) RETURNING id,email`, [email, `검증${kind}`.slice(0, 20), Boolean(spec.admin)])).rows[0];
      data.users[kind] = { ...row, kind };
      writeFileSync(file, JSON.stringify(data));
      await db.query(`INSERT INTO "UserIdentityInfo" (user_id,real_name,department,consent_version,consented_at,updated_at) VALUES ($1,'테스트','테스트 기관','2026-10-14',now(),now())`, [row.id]);
    }
    const superId = data.users.super.id;
    for (const [kind, spec] of Object.entries(KINDS)) {
      const id = data.users[kind].id;
      for (const permission of spec.grants ?? []) await db.query(`INSERT INTO "AdminPermissionGrant" (user_id,permission,granted_by_user_id) VALUES ($1,$2,$3)`, [id, permission, superId]);
      if (spec.scope !== undefined) await db.query(`INSERT INTO "InstitutionOfficer" (user_id,organization_id,facility,granted_by_user_id,updated_at) VALUES ($1,$2,'검증 시설',$3,now())`, [id, data.organizations[spec.scope].id, superId]);
    }
    const confirmed = (org, by) => JSON.stringify({ state: "REPORTED", place: "본관", confirmedAt: new Date().toISOString(), confirmedBy: by, institution: org.name });
    const mk = async (title, org) => (await db.query(`INSERT INTO "FoundPost" (user_id,title,description,category,category_code,campus,updated_at,custody,custody_organization_id) VALUES ($1,$2,'Preview 권한 검증','기타','etc','자연캠퍼스',now(),$3::jsonb,$4) RETURNING id`, [data.users.plain.id, `${marker} ${title}`, org ? confirmed(org, superId) : JSON.stringify({ state: "REPORTED", place: "본관" }), org?.id ?? null])).rows[0].id;
    data.posts = [await mk("미접수", null), await mk("A 기관 보관 1", data.organizations[0]), await mk("A 기관 보관 2", data.organizations[0]), await mk("B 기관 보관", data.organizations[1])];
    data.cookies = {};
    for (const [kind, user] of Object.entries(data.users)) data.cookies[kind] = await cookieFor(user, secret);
    writeFileSync(file, JSON.stringify(data));
    console.log("fixtures created:", Object.keys(data.users).length, "accounts,", data.organizations.length, "agencies,", data.posts.length, "posts");
  } else if (process.argv[2] === "refresh") {
    const data = JSON.parse(readFileSync(file)); const env = parse(readFileSync(".env"));
    for (const [kind, user] of Object.entries(data.users)) data.cookies[kind] = await cookieFor(user, env.AUTH_SECRET ?? env.NEXTAUTH_SECRET);
    writeFileSync(file, JSON.stringify(data)); console.log("sessions refreshed");
  } else if (process.argv[2] === "http") {
    const data = JSON.parse(readFileSync(file));
    const bypass = await bypassHeaders();
    const results = [];
    const call = async (kind, path, init = {}) => {
      const r = await fetch(BASE + path, { redirect: "manual", ...init, headers: { ...bypass, cookie: `__Secure-authjs.session-token=${data.cookies[kind]}`, ...(init.headers ?? {}) } });
      return { status: r.status, location: r.headers.get("location"), text: init.noBody ? "" : await r.text() };
    };
    const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail); };
    const redirectsHome = (r) => r.status >= 300 && r.status < 400 && /^(\/|https?:\/\/[^/]+\/)$/.test(r.location ?? "");
    // --- page access by permission
    const page = async (kind, path) => call(kind, path);
    for (const [path, allowed] of [
      ["/admin", ["super", "returnOnly", "receiveOnly", "restoreOnly", "reportsView", "reportsProcess", "statsOps", "statsUsers", "statsAdmins", "usersView", "usersSanction", "institutions", "external", "promo"]],
      ["/admin/reports", ["super", "reportsView", "reportsProcess"]],
      ["/admin/users", ["super", "usersView", "usersSanction"]],
      ["/admin/sanctions", ["super", "usersSanction"]],
      ["/admin/posts", ["super"]],
      ["/admin/external-access", ["super", "external"]],
      ["/admin/organizations", ["super", "institutions"]],
      ["/admin/announcements", ["super"]],
      ["/admin/stats", ["super", "statsOps", "statsUsers", "statsAdmins", "promo"]],
      ["/admin/proposals", ["super"]],
      ["/items", ["super", "returnOnly", "receiveOnly", "restoreOnly"]],
    ]) {
      for (const kind of Object.keys(data.users)) {
        const r = await page(kind, path);
        const open = r.status === 200;
        check(`${path} ${allowed.includes(kind) ? "opens" : "is closed"} for ${kind}`, allowed.includes(kind) ? open : !open && (redirectsHome(r) || r.status === 404 || r.status === 307), `${r.status} ${r.location ?? ""}`);
      }
    }
    // --- API
    for (const [method, path, allowed] of [
      ["GET", "/api/admin/reports", ["super", "reportsView", "reportsProcess"]],
      ["GET", "/api/admin/users", ["super", "usersView", "usersSanction"]],
      ["GET", "/api/admin/posts?type=found", ["super"]],
    ]) {
      for (const kind of Object.keys(data.users)) {
        const r = await call(kind, path, { method });
        const open = r.status === 200;
        check(`API ${method} ${path} ${allowed.includes(kind) ? "allows" : "denies"} ${kind}`, allowed.includes(kind) ? open : r.status === 403 || r.status === 401, String(r.status));
      }
    }
    for (const kind of Object.keys(data.users).filter((k) => k !== "super")) {
      const r = await call(kind, "/api/admin/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ googleTestModeEnabled: true }) });
      check(`API PATCH /api/admin/settings denies ${kind}`, r.status === 403, String(r.status));
    }
    check("API without session is 401", (await fetch(BASE + "/api/admin/reports", { headers: bypass })).status === 401);
    // --- stats tabs by permission
    const tabs = async (kind, tab) => (await call(kind, `/admin/stats?tab=${tab}`)).text;
    const has = (html, label) => html.includes(label);
    const opsHtml = await tabs("statsOps", "admins");
    check("statsOps asking tab=admins gets operations only", has(opsHtml, "일반 사용자 운영 통계") && !has(opsHtml, "관리자 서비스 이용") && !has(opsHtml, "개발 통계"));
    const usersHtml = await tabs("statsUsers", "ops");
    check("statsUsers sees the users tab only", has(usersHtml, "사용자 통계") && !has(usersHtml, "일반 사용자 운영 통계</a>") && !has(usersHtml, "관리자 활동</a>"));
    const adminsHtml = await tabs("statsAdmins", "ops");
    check("statsAdmins sees admin activity only", has(adminsHtml, "관리자 서비스 이용") && !has(adminsHtml, "사용자 통계</a>") && !has(adminsHtml, "일반 사용자 운영 통계</a>"));
    const promoHtml = await tabs("promo", "ops");
    check("promo-only sees the link builder, no statistics", has(promoHtml, "홍보 링크") && !has(promoHtml, "일반 사용자 운영 통계</a>"));
    const superHtml = await tabs("super", "dev");
    check("full admin still sees every tab incl. 개발 통계", has(superHtml, "개발 통계") && has(superHtml, "관리자 활동") && has(superHtml, "사용자 통계"));
    // --- admin center content is filtered
    const center = (await call("reportsView", "/admin")).text;
    check("center for reportsView shows reports, hides users/settings tiles", has(center, "신고 대기") && !has(center, "전체 사용자") && !has(center, "공지사항") && !has(center, "Google 테스트 모드"));
    const centerRet = (await call("returnOnly", "/admin")).text;
    check("center for returnOnly shows only the items entry", has(centerRet, "기관 물품 현황") && !has(centerRet, "신고 대기") && !has(centerRet, "전체 사용자"));
    // --- header menu
    const homeFor = async (kind) => (await call(kind, "/")).text;
    check("plain user has no 관리자 menu", !/href="\/admin"/.test(await homeFor("plain")));
    check("returnOnly has the 관리자 menu and no standalone 물품 관리 link", /href="\/admin"/.test(await homeFor("returnOnly")) && !/href="\/items"[^>]*>물품 관리</.test(await homeFor("returnOnly")));
    // --- item management by permission and scope
    const patch = (kind, postId, management) => call(kind, `/api/posts/${postId}?type=found`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ management }) });
    const stamp = async (postId) => (await db.query(`SELECT to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS t FROM "FoundPost" WHERE id=$1`, [postId])).rows[0].t;
    const [pUn, pA1, pA2, pB] = data.posts;
    let r = await patch("returnOnly", pUn, { action: "confirm", expectedUpdatedAt: await stamp(pUn), confirmed: true, place: "본관" });
    check("return-only cannot confirm receipt", r.status === 403, String(r.status));
    r = await patch("returnOnly", pA1, { action: "location", expectedUpdatedAt: await stamp(pA1), confirmed: true, place: "다른 곳" });
    check("return-only cannot change the place", r.status === 403, String(r.status));
    r = await patch("returnOnly", pB, { action: "complete", expectedUpdatedAt: await stamp(pB), confirmed: true });
    check("return-only cannot return another agency's item", r.status === 403, String(r.status));
    r = await patch("returnOnly", pA1, { action: "complete", expectedUpdatedAt: await stamp(pA1), confirmed: true });
    check("return-only can return an item of its own agency", r.status === 200, `${r.status} ${r.text.slice(0, 80)}`);
    r = await patch("returnOnly", pA1, { action: "complete", expectedUpdatedAt: await stamp(pA1), confirmed: true });
    check("returning an already completed item is refused", r.status === 409, String(r.status));
    r = await patch("returnOnly", pA1, { action: "reopen", expectedUpdatedAt: await stamp(pA1), confirmed: true, reason: "복구 시도" });
    check("return-only cannot restore", r.status === 403, String(r.status));
    r = await patch("restoreOnly", pA1, { action: "reopen", expectedUpdatedAt: await stamp(pA1), confirmed: true, reason: "잘못 반환" });
    check("restore-only can restore an item of its own agency with a reason", r.status === 200, `${r.status} ${r.text.slice(0, 80)}`);
    r = await patch("receiveOnly", pUn, { action: "confirm", expectedUpdatedAt: await stamp(pUn), confirmed: true, place: "본관 1층" });
    check("receive-only can confirm receipt", r.status === 200, `${r.status} ${r.text.slice(0, 80)}`);
    r = await patch("receiveOnly", pA2, { action: "complete", expectedUpdatedAt: await stamp(pA2), confirmed: true });
    check("receive-only cannot return", r.status === 403, String(r.status));
    const [first, second] = await Promise.all([1, 2].map(() => patch("returnOnly", pA2, { action: "complete", expectedUpdatedAt: "x" })));
    check("a malformed request is rejected, not applied", first.status === 400 && second.status === 400, `${first.status}/${second.status}`);
    const same = await stamp(pA2);
    const race = await Promise.all([1, 2].map(() => patch("returnOnly", pA2, { action: "complete", expectedUpdatedAt: same, confirmed: true })));
    check("two simultaneous returns: exactly one succeeds", race.filter((x) => x.status === 200).length === 1 && race.filter((x) => x.status === 409).length === 1, race.map((x) => x.status).join("/"));
    check("a plain member cannot manage items", (await patch("plain", pB, { action: "complete", expectedUpdatedAt: await stamp(pB), confirmed: true })).status === 403);
    console.log(results.every((x) => x.ok) ? `ALL ${results.length} HTTP CHECKS PASSED` : `FAILED: ${results.filter((x) => !x.ok).length} of ${results.length}`);
    process.exitCode = results.every((x) => x.ok) ? 0 : 1;
  } else if (process.argv[2] === "validate") {
    const data = JSON.parse(readFileSync(file));
    const ids = Object.values(data.users).map((u) => u.id);
    const q = async (sql, p = [ids]) => (await db.query(sql, p)).rows;
    console.log("admins among fixtures:", await q(`SELECT id FROM "User" WHERE id=ANY($1) AND is_admin ORDER BY id`));
    console.log("subject grants:", await q(`SELECT permission FROM "AdminPermissionGrant" WHERE user_id=$1 ORDER BY 1`, [data.users.subject.id]));
    console.log("audit:", await q(`SELECT action, before, after, reason FROM "InstitutionOfficerAudit" WHERE target_user_id=$1 ORDER BY id`, [data.users.subject.id]));
    console.log("status changes:", await q(`SELECT post_id, action, activity_role FROM "PostStatusChange" WHERE post_id=ANY($1) ORDER BY id`, [data.posts]));
    console.log("notifications:", await q(`SELECT user_id, type, count(*)::int FROM "Notification" WHERE user_id=ANY($1) GROUP BY 1,2`));
    console.log("posts:", await q(`SELECT id, status, custody_organization_id FROM "FoundPost" WHERE id=ANY($1) ORDER BY id`, [data.posts]));
  } else if (process.argv[2] === "cleanup") {
    const data = JSON.parse(readFileSync(file));
    const ids = Object.values(data.users).map((u) => u.id), orgs = data.organizations.map((o) => o.id);
    assert.ok(data.marker.startsWith("permission-test-"));
    const existing = (await db.query('SELECT email FROM "User" WHERE id=ANY($1::int[])', [ids])).rows;
    assert.ok(existing.every((u) => u.email.startsWith(data.marker + "-")), "Refusing to delete a non-fixture account");
    const local = parse(readFileSync(".env"));
    const actors = ids.map((id) => createHmac("sha256", `activity-day:v1:${local.AUTH_SECRET ?? ""}`).update(String(id)).digest("base64url").slice(0, 22));
    await db.query("BEGIN");
    await db.query('DELETE FROM "ActivityDay" WHERE actor=ANY($1::text[])', [actors]);
    await db.query('DELETE FROM "Notification" WHERE user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "PostStatusChange" WHERE changed_by_user_id=ANY($1::int[]) OR post_id=ANY($2::int[])', [ids, data.posts]);
    await db.query('DELETE FROM "InstitutionOfficerAudit" WHERE actor_user_id=ANY($1::int[]) OR target_user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "AdminPermissionGrant" WHERE user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "InstitutionOfficer" WHERE user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "ChatRoom" WHERE initiator_user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "FoundPost" WHERE user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "LostPost" WHERE user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "AdminVisit" WHERE admin_user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "AdminActivityLog" WHERE admin_user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "UserIdentityInfo" WHERE user_id=ANY($1::int[])', [ids]);
    await db.query('DELETE FROM "Organization" WHERE id=ANY($1::int[])', [orgs]);
    await db.query('DELETE FROM "User" WHERE id=ANY($1::int[])', [ids]);
    await db.query("COMMIT");
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "User" WHERE id=ANY($1::int[])', [ids])).rows[0].n, 0);
    console.log("fixtures removed: zero test accounts, agencies, grants remain");
  } else throw new Error("usage: adminPermissionsPreview.mjs setup|refresh|http|validate|cleanup");
} finally {
  await db.end();
}
