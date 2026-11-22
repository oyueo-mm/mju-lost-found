// Security hardening 2026-11-22: try to defeat P-5 (session revocation),
// A-4 (AI search ceilings), A-3 (unattached upload cap + sweep) and A-5
// (public read brake) against a REAL local server and the Preview DB/Storage.
//
//   node scripts/regression/build-preview.mjs --confirm-preview
//   node --env-file=.vercel/regression-preview.env --env-file=.env.preview.local scripts/regression/hardening-local.mjs --confirm-preview
//
// The server (127.0.0.1:3105) runs with a throwaway AUTH_SECRET and VERCEL=1,
// so the client address comes from x-vercel-forwarded-for exactly as on
// Vercel (that is what the per-network limits key on). Fixtures (recorded in
// .vercel/hardening-<uuid>.json, all deleted at the end): members U and S, a
// sanction-only admin A, a full admin F, one lost post of U, two Storage
// objects, UploadIntent rows, and shared rate-limit counters that are seeded
// for a check and then restored to their previous values.
// Output: check names, status codes and counts only.
import "../db/install-guard.mjs";
import { assertDatabaseEnvironment, assertScriptSupabaseAccess } from "../../src/lib/db/accessPolicy.mjs";
import { createJiti } from "jiti";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";

if (!process.argv.includes("--confirm-preview") || assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview" || assertScriptSupabaseAccess(process.env) !== "preview") {
  throw new Error("Preview confirmation required");
}

const PORT = 3105;
const base = `http://localhost:${PORT}`;
const marker = `hardening-${randomUUID()}`, manifest = `.vercel/${marker}.json`;
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } });
const { prisma } = await jiti.import("../../src/lib/db/prisma.ts");
const terms = await jiti.import("../../src/lib/auth/terms.ts");
const { revokeChatRealtimeSession } = await jiti.import("../../src/lib/chat/realtimeSession.ts");
const { networkKey, RATE_LIMITS } = await jiti.import("../../src/lib/rateLimit/index.ts");
const { sweepUnattachedUploads, OPEN_UPLOAD_CAP } = await jiti.import("../../src/lib/images/uploadIntents.ts");
const { READ_LIMITS } = await jiti.import("../../src/lib/security/readGuard.ts");
const { getSupabaseAdminClient } = await jiti.import("../../src/lib/supabase/adminClient.ts");
const require = createRequire(import.meta.url);
const { encode } = await import(pathToFileURL(require.resolve("@auth/core/jwt")));

const secret = randomUUID() + randomUUID();
const users = {};
let post, server, cleanupOk = false;
const storagePaths = [];
const seededCounters = []; // { key, windowStart, previous }
const checks = [];
const check = (name, ok, detail = {}) => checks.push({ name, ok: Boolean(ok), ...detail });
const save = () => writeFileSync(manifest, JSON.stringify({ marker, userIds: Object.values(users).map((u) => u.id), lostPostId: post?.id, storagePaths, seededCounters: seededCounters.map((c) => c.key) }));
const now = () => Math.floor(Date.now() / 1000);

const cookie = async (user, { authTime, sid = randomUUID() } = {}) => {
  const token = { sub: String(user.id), userId: user.id, nickname: user.nickname, realtimeSessionId: sid, ...(authTime === undefined ? {} : { authTime }) };
  return { value: `authjs.session-token=${await encode({ token, secret, salt: "authjs.session-token" })}`, sid };
};
async function call(method, path, { cookie: c, ip = "198.51.100.10", headers = {}, body } = {}) {
  const res = await fetch(base + path, {
    method, redirect: "manual",
    headers: { "x-vercel-forwarded-for": ip, ...(c ? { cookie: c.value } : {}), ...(body && typeof body === "string" ? { "content-type": "application/json", origin: base } : {}), ...headers },
    body,
  });
  const text = await res.text().catch(() => "");
  let code = null;
  try { code = JSON.parse(text).code ?? null; } catch { /* not JSON */ }
  // A page that redirects after its shell started streaming answers 200 with
  // the redirect inside the HTML (meta refresh / RSC redirect), not a 307.
  const toBusy = /url=\/busy|NEXT_REDIRECT;[a-z]*;\/busy/.test(text);
  return { status: res.status, code, location: res.headers.get("location"), toBusy, hasMarker: text.includes(marker) };
}
const ipKey = (ip) => `ip:${createHash("sha256").update(`${secret}:${networkKey(ip)}`).digest("hex").slice(0, 32)}`;
async function seedCounter(key, windowSeconds, count) {
  const ms = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / ms) * ms);
  const prev = await prisma.rateLimitCounter.findUnique({ where: { key_windowStart: { key, windowStart } } });
  seededCounters.push({ key, windowStart, previous: prev?.count ?? null }); save();
  await prisma.rateLimitCounter.upsert({ where: { key_windowStart: { key, windowStart } }, create: { key, windowStart, count }, update: { count } });
}
const makeUser = (tag, extra = {}) => prisma.user.create({ data: {
  email: `${marker}-${tag}@test.example.invalid`, name: "Synthetic hardening", nickname: `Hard ${tag} ${marker.slice(-4)}`,
  privacyConsentAt: new Date(), privacyConsentVersion: terms.CURRENT_PRIVACY_VERSION, termsAcceptedAt: new Date(), termsVersion: terms.CURRENT_TERMS_VERSION,
  identityConsentVersion: terms.CURRENT_IDENTITY_CONSENT_VERSION, ...extra } });

try {
  await new Promise((resolve, reject) => { const p = createServer(); p.once("error", reject); p.listen(PORT, "127.0.0.1", () => p.close(resolve)); });
  for (const tag of ["U", "S", "A", "F"]) { users[tag] = await makeUser(tag, tag === "F" ? { isAdmin: true } : {}); save(); }
  for (const u of Object.values(users)) {
    await prisma.userIdentityInfo.create({ data: { userId: u.id, realName: "Synthetic", department: "Synthetic", consentVersion: terms.CURRENT_IDENTITY_CONSENT_VERSION, consentedAt: new Date() } });
  }
  await prisma.adminPermissionGrant.create({ data: { userId: users.A.id, permission: "users.sanction", grantedByUserId: users.F.id } });
  post = await prisma.lostPost.create({ data: { userId: users.U.id, title: marker, description: "synthetic hardening post", category: "기타" } }); save();

  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], { env: { ...process.env, AUTH_SECRET: secret, AUTH_TRUST_HOST: "true", VERCEL: "1" }, stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 90; i++) { try { if ((await fetch(base + "/login")).status < 500) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 1000)); }

  // ---------------- P-5 ----------------
  const u1 = await cookie(users.U, { authTime: now() - 100 }), u2 = await cookie(users.U, { authTime: now() - 50 });
  check("P-5 two live sessions of U", (await call("GET", "/api/notifications", { cookie: u1 })).status === 200 && (await call("GET", "/api/notifications", { cookie: u2 })).status === 200);
  await revokeChatRealtimeSession({ userId: users.U.id, realtimeSessionId: u1.sid, exp: now() + 3600 });
  const afterDevice = [(await call("GET", "/api/notifications", { cookie: u1 })).status, (await call("GET", "/api/notifications", { cookie: u2 })).status];
  check("P-5 signed-out session copy refused, other device kept", afterDevice[0] === 401 && afterDevice[1] === 200, { statuses: afterDevice });

  const s = await cookie(users.S, { authTime: now() });
  const byMember = await call("PATCH", `/api/admin/users/${users.U.id}`, { cookie: s, body: JSON.stringify({ action: "revoke_sessions" }) });
  check("P-5 a member cannot force sign-out", byMember.status === 403, { status: byMember.status });
  const a = await cookie(users.A, { authTime: now() });
  const onAdmin = await call("PATCH", `/api/admin/users/${users.F.id}`, { cookie: a, body: JSON.stringify({ action: "revoke_sessions" }) });
  check("P-5 sanction-only admin cannot sign out a full admin", onAdmin.status === 403, { status: onAdmin.status });
  const crossSite = await call("PATCH", `/api/admin/users/${users.U.id}`, { cookie: a, body: JSON.stringify({ action: "revoke_sessions" }), headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } });
  check("P-5 forced sign-out refused cross-site (P-2 kept)", crossSite.status === 403, { status: crossSite.status });
  check("P-5 nothing revoked by refused attempts", (await call("GET", "/api/notifications", { cookie: u2 })).status === 200);

  const forced = await call("PATCH", `/api/admin/users/${users.U.id}`, { cookie: a, body: JSON.stringify({ action: "revoke_sessions" }) });
  const legacy = await cookie(users.U, {}); // pre-P-5 cookie: no authTime
  const afterForce = [(await call("GET", "/api/notifications", { cookie: u2 })).status, (await call("GET", "/api/notifications", { cookie: legacy })).status];
  await new Promise((r) => setTimeout(r, 1100));
  const fresh = await cookie(users.U, { authTime: now() + 1 });
  const freshStatus = (await call("GET", "/api/notifications", { cookie: fresh })).status;
  const logged = await prisma.adminActivityLog.count({ where: { adminUserId: users.A.id, action: "user.sessions_revoke", targetId: users.U.id } });
  const openRealtime = await prisma.chatRealtimeSession.count({ where: { userId: users.U.id, revokedAt: null } });
  check("P-5 forced sign-out ends old and pre-P-5 sessions, new sign-in works, logged",
    forced.status === 200 && afterForce.every((x) => x === 401) && freshStatus === 200 && logged === 1 && openRealtime === 0,
    { forced: forced.status, afterForce, freshStatus, logged, openRealtime });
  check("P-5 admin keeps working after forcing another user out", (await call("GET", "/api/notifications", { cookie: a })).status === 200);

  // ---------------- A-4 ----------------
  const form = () => { const f = new FormData(); f.set("q", "검은색 지갑"); return f; };
  const v6 = "2001:db8:4:4::1";
  await seedCounter(`aiSearch:${ipKey(v6)}:60`, 60, RATE_LIMITS.aiSearch.anonymous[0].max);
  const rotated = await call("POST", "/api/posts?mode=ai&type=lost", { ip: "2001:db8:4:4:dead:beef:1:2", body: form() });
  check("A-4 rotating addresses inside one IPv6 /64 hits the same limit", rotated.status === 429, { status: rotated.status });
  await seedCounter("aiSearchAnonymousGlobal:g:86400", 86400, RATE_LIMITS.aiSearchAnonymousGlobal.global[1].max);
  const anonBusy = await call("POST", "/api/posts?mode=ai&type=lost", { ip: "203.0.113.44", body: form() });
  check("A-4 anonymous ceiling refuses a fresh network with AI_SEARCH_BUSY", anonBusy.status === 429 && anonBusy.code === "AI_SEARCH_BUSY", anonBusy);
  const member = await call("POST", "/api/posts?mode=ai&type=lost", { ip: "203.0.113.44", cookie: fresh, body: form() });
  check("A-4 a signed-in member still gets AI search past the anonymous ceiling", member.status === 200, { status: member.status });
  const unified = await call("GET", `/api/posts?${new URLSearchParams({ mode: "unified", type: "lost", q: "어제 도서관에서 검은색 반지갑을 잃어버렸어요" })}`, { ip: "203.0.113.45" });
  check("A-4 unified search degrades to keywords at the ceiling (200)", unified.status === 200, { status: unified.status });
  const keyword = await call("GET", "/api/posts?type=lost&q=지갑", { ip: "203.0.113.46" });
  check("A-4 plain keyword search unaffected", keyword.status === 200, { status: keyword.status });

  // ---------------- A-3 ----------------
  const minted = await call("POST", "/api/upload", { cookie: fresh, body: JSON.stringify({ postType: "lost", postId: post.id, contentType: "image/jpeg" }) });
  const recorded = await prisma.uploadIntent.count({ where: { userId: users.U.id, bucket: "post-images" } });
  check("A-3 minted upload URL is recorded", minted.status === 200 && recorded === 1, { status: minted.status, recorded });
  const fakes = Array.from({ length: OPEN_UPLOAD_CAP.user - 1 }, () => ({ path: `posts/lost/${post.id}/${randomUUID()}.jpg`, bucket: "post-images", userId: users.U.id }));
  await prisma.uploadIntent.createMany({ data: fakes });
  const capped = await call("POST", "/api/upload", { cookie: fresh, body: JSON.stringify({ postType: "lost", postId: post.id, contentType: "image/jpeg" }) });
  const afterCap = await prisma.uploadIntent.count({ where: { userId: users.U.id } });
  check("A-3 open-upload cap refuses the next URL and records nothing", capped.status === 429 && afterCap === OPEN_UPLOAD_CAP.user, { status: capped.status, afterCap });
  const other = await call("POST", "/api/upload", { cookie: s, body: JSON.stringify({ postType: "lost", postId: post.id, contentType: "image/jpeg" }) });
  check("A-3 still cannot mint for someone else's post", other.status === 403, { status: other.status });

  // Sweep: one real unattached object and one real object a gallery row uses.
  const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");
  const bucket = getSupabaseAdminClient().storage.from("post-images");
  const orphan = `posts/lost/${post.id}/${randomUUID()}.jpg`, used = `posts/lost/${post.id}/${randomUUID()}.jpg`;
  for (const p of [orphan, used]) { const { error } = await bucket.upload(p, jpeg, { contentType: "image/jpeg" }); if (error) throw new Error("fixture upload failed"); storagePaths.push(p); save(); }
  const old = new Date(Date.now() - 25 * 3600 * 1000);
  await prisma.uploadIntent.createMany({ data: [orphan, used].map((p) => ({ path: p, bucket: "post-images", userId: users.U.id, createdAt: old })) });
  const { publicUrlFor } = await jiti.import("../../src/lib/images/supabaseAdmin.ts");
  await prisma.postImage.create({ data: { lostPostId: post.id, imageUrl: publicUrlFor(used), displayOrder: 0, isPrimary: true } });
  const swept = await sweepUnattachedUploads();
  const exists = async (p) => { const { data } = await bucket.list(`posts/lost/${post.id}`, { search: p.split("/").pop() }); return (data ?? []).length > 0; };
  const [orphanGone, usedKept] = [!(await exists(orphan)), await exists(used)];
  const [orphanRow, usedRow] = await Promise.all([orphan, used].map((p) => prisma.uploadIntent.findUnique({ where: { path: p } })));
  check("A-3 sweep deletes the unattached object and keeps the used one",
    orphanGone && usedKept && orphanRow?.deletedAt && usedRow?.attachedAt && !usedRow?.deletedAt,
    { orphanGone, usedKept, deleted: swept.deleted, referenced: swept.referenced, failed: swept.failed });
  const recentLeft = await prisma.uploadIntent.count({ where: { userId: users.U.id, deletedAt: null, attachedAt: null } });
  check("A-3 sweep leaves recent (under a day) uploads alone", recentLeft === OPEN_UPLOAD_CAP.user, { recentLeft });

  // ---------------- A-5 (in-memory, last: it fills this server's counters) ----------------
  // Decision A (2026-11-22): members counted per verified member, anonymous
  // per network. Probes use a path that answers 400 before any query.
  const probe = "/api/posts/not-a-number?type=lost";
  // The guard counts in fixed one-minute windows: a burst that straddles a
  // minute boundary starts over. Start bursts with room left in the window
  // and send them in parallel batches so they finish inside it.
  const freshWindow = async () => { const into = Date.now() % 60_000; if (into > 30_000) await new Promise((r) => setTimeout(r, 60_000 - into + 300)); };
  async function burst(n, opts) {
    const statuses = [];
    for (let i = 0; i < n; i += 50) statuses.push(...(await Promise.all(Array.from({ length: Math.min(50, n - i) }, (_, k) => call("GET", probe, typeof opts === "function" ? opts(i + k) : opts)))).map((r) => r.status));
    return { allowed: statuses.filter((x) => x !== 429).length, refused: statuses.filter((x) => x === 429).length };
  }
  const flood = "192.0.2.77";
  await freshWindow();
  const anonBurst = await burst(READ_LIMITS.perAnonymousNetwork + 5, { ip: flood });
  const lastCode = (await call("GET", probe, { ip: flood })).code;
  check("A-5 one anonymous network is braked right after its per-minute limit", anonBurst.allowed === READ_LIMITS.perAnonymousNetwork && anonBurst.refused === 5 && lastCode === "READ_BUSY", { ...anonBurst, lastCode });
  const page = await call("GET", "/lost", { ip: flood });
  check("A-5 a braked network's page view goes to /busy without the list", ((page.status === 307 && /\/busy$/.test(page.location ?? "")) || page.toBusy) && !page.hasMarker, { status: page.status, toBusy: page.toBusy, listed: page.hasMarker });
  // Bypass attempts from the braked network
  const forged = { value: "authjs.session-token=forged-not-a-jwe" };
  check("A-5 bypass: a forged session cookie is still braked", (await call("GET", probe, { ip: flood, cookie: forged })).status === 429);
  const foreign = { value: `authjs.session-token=${await encode({ token: { sub: "1", userId: 1 }, secret: randomUUID() + randomUUID(), salt: "authjs.session-token" })}` };
  check("A-5 bypass: a cookie signed with another secret is still braked", (await call("GET", probe, { ip: flood, cookie: foreign })).status === 429);
  const pf = await call("GET", "/lost", { ip: flood, headers: { rsc: "1", "next-router-prefetch": "1" } });
  check("A-5 bypass: a prefetch-flagged request is still braked (no list)", !pf.hasMarker && (pf.status === 307 || pf.toBusy || /busy/.test(pf.location ?? "") || pf.status >= 300), { status: pf.status });
  check("A-5 bypass: a bearer token instead of the cookie is still braked", (await call("GET", probe, { ip: flood, headers: { authorization: `Bearer ${(await cookie(users.U)).value.split("=").slice(1).join("=")}` } })).status === 429);
  // Genuine members behind the same exhausted campus address
  const memberPage = await call("GET", "/lost", { ip: flood, cookie: await cookie(users.U) });
  check("A-5 campus: a signed-in member behind the braked address still gets the list", memberPage.status === 200 && memberPage.hasMarker && !memberPage.toBusy, { status: memberPage.status });
  // Campus simulation: 30 members and 25 anonymous people behind ONE address, 20 reads each.
  const campus = "198.51.100.200";
  const memberCookies = await Promise.all(Array.from({ length: 30 }, (_, k) => cookie({ id: 900001 + k, nickname: `campus-${k}` })));
  let memberRefused = 0, anonRefused = 0;
  for (let round = 0; round < 20; round++) {
    const batch = [...memberCookies.map((c) => call("GET", probe, { ip: campus, cookie: c })), ...Array.from({ length: 25 }, () => call("GET", probe, { ip: campus }))];
    const rs = await Promise.all(batch);
    memberRefused += rs.slice(0, 30).filter((r) => r.status === 429).length;
    anonRefused += rs.slice(30).filter((r) => r.status === 429).length;
  }
  check("A-5 campus: 30 members + 25 anonymous behind one address, 20 reads each, nobody braked", memberRefused === 0 && anonRefused === 0, { memberReads: 600, anonymousReads: 500, memberRefused, anonRefused });
  // A member's own flood is bounded, and only that member is affected
  const heavy = await cookie({ id: 900100, nickname: "heavy" });
  await freshWindow();
  const memberBurst = await burst(READ_LIMITS.perMember + 5, (i) => ({ ip: `198.51.100.${(i % 200) + 1}`, cookie: heavy }));
  check("A-5 member flood: one member is braked after the per-member limit, even across addresses", memberBurst.allowed === READ_LIMITS.perMember && memberBurst.refused === 5, memberBurst);
  check("A-5 member flood: other members are unaffected", (await call("GET", probe, { ip: "198.51.100.250", cookie: memberCookies[0] })).status === 400);
  const control = await call("GET", "/lost", { ip: "192.0.2.80" });
  check("A-5 control: another network's /lost lists the fixture post", control.status === 200 && control.hasMarker && !control.toBusy, { status: control.status });
  check("A-5 /busy itself answers", (await call("GET", "/busy", { ip: flood })).status === 200);
  check("A-5 another network is unaffected", (await call("GET", `/api/posts/${post.id}?type=lost`, { ip: "192.0.2.78" })).status === 200);
  check("A-5 comments read unaffected for another network", (await call("GET", `/api/posts/${post.id}/comments?type=lost`, { ip: "192.0.2.79" })).status === 200);
} catch (error) {
  check("suite ran", false, { error: error?.message?.slice(0, 120) ?? "error" });
} finally {
  server?.kill();
  try {
    for (const c of seededCounters.reverse()) {
      const where = { key_windowStart: { key: c.key, windowStart: c.windowStart } };
      if (c.previous === null) await prisma.rateLimitCounter.deleteMany({ where: { key: c.key, windowStart: c.windowStart } });
      else await prisma.rateLimitCounter.update({ where, data: { count: c.previous } });
    }
    if (storagePaths.length) await getSupabaseAdminClient().storage.from("post-images").remove(storagePaths);
    const ids = Object.values(users).map((u) => u.id);
    if (post) { const p = await prisma.lostPost.findUnique({ where: { id: post.id } }); if (p && p.title !== marker) throw new Error("ownership"); if (p) await prisma.lostPost.delete({ where: { id: post.id } }); }
    if (ids.length) {
      const owned = await prisma.user.count({ where: { id: { in: ids }, email: { startsWith: marker } } });
      if (owned !== ids.length) throw new Error("ownership");
      await prisma.adminActivityLog.deleteMany({ where: { adminUserId: { in: ids } } });
      await prisma.adminPermissionGrant.deleteMany({ where: { userId: { in: ids } } });
      await prisma.uploadIntent.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    cleanupOk = true;
  } catch (error) { console.error("cleanup failed; see", manifest, error?.message?.slice(0, 120)); }
  const passed = checks.length > 0 && checks.every((c) => c.ok) && cleanupOk;
  console.log(JSON.stringify({ suite: "hardening-local", passed, checks, cleanupOk, manifest }, null, 1));
  await prisma.$disconnect();
  process.exit(passed ? 0 : 1);
}
