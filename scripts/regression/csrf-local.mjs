// P-2/P-3 (security audit 2026-11-21): try to bypass the same-origin check and
// the read-state split against a REAL local server and the Preview DB.
//
//   node scripts/regression/build-preview.mjs --confirm-preview
//   node --env-file=.vercel/regression-preview.env --env-file=.env.preview.local scripts/regression/csrf-local.mjs --confirm-preview
//
// Fixtures (created here, recorded in .vercel/csrf-<uuid>.json, deleted at the
// end): members A, B (one room, 3 messages A->B, 3 unread "message"
// notifications for B) and an outsider C. Sessions are minted with a
// throwaway AUTH_SECRET that only this local server (127.0.0.1:3103) knows.
//
// Part 1 -- forged headers WITH B's session cookie (= "what if SameSite failed"):
//   every state-changing call from a foreign origin must be 403 and change
//   nothing; same-origin calls must keep working.
// Part 2 -- a real browser (Chromium + WebKit) logged in as B visits an
//   attacker page on another site (127.0.0.1:3104) that auto-submits a form,
//   fires a no-cors fetch, loads an <img>, and finally navigates top-level to
//   GET .../messages (the one request a Lax cookie is sent with). B's read
//   cursor and notifications must not move.
// Output: pass/fail and status codes only, never cookies or message text.
import "../db/install-guard.mjs";
import { assertDatabaseEnvironment, assertScriptSupabaseAccess } from "../../src/lib/db/accessPolicy.mjs";
import { createJiti } from "jiti";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";

if (!process.argv.includes("--confirm-preview") || assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview" || assertScriptSupabaseAccess(process.env) !== "preview") {
  throw new Error("Preview confirmation required");
}

const PORT = 3103, ATTACKER_PORT = 3104;
const base = `http://localhost:${PORT}`, attacker = `http://127.0.0.1:${ATTACKER_PORT}`;
const marker = `csrf-${randomUUID()}`, manifest = `.vercel/${marker}.json`;
const users = [];
let room, server, attackerServer, cleanupOk = false;
const messageIds = [];
const save = () => writeFileSync(manifest, JSON.stringify({ marker, userIds: users.map((u) => u.id), roomId: room?.id }));
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } });
const { prisma } = await jiti.import("../../src/lib/db/prisma.ts"), terms = await jiti.import("../../src/lib/auth/terms.ts");
const require = createRequire(import.meta.url);
const { encode } = await import(pathToFileURL(require.resolve("@auth/core/jwt")));
const secret = randomUUID() + randomUUID(), sessions = [];
const checks = [];
const check = (name, ok, detail = {}) => { checks.push({ name, ok: Boolean(ok), ...detail }); };

const cookieOf = (i) => `authjs.session-token=${sessions[i]}`;
async function call(i, method, path, { headers = {}, body } = {}) {
  const res = await fetch(base + path, { method, redirect: "manual", headers: { ...(i === null ? {} : { cookie: cookieOf(i) }), ...headers }, body });
  await res.arrayBuffer().catch(() => {});
  return res.status;
}
const state = async () => ({
  cursor: (await prisma.chatRead.findUnique({ where: { chatRoomId_userId: { chatRoomId: room.id, userId: users[1].id } } }))?.lastReadMessageId ?? null,
  unread: await prisma.notification.count({ where: { userId: users[1].id, isRead: false } }),
  messages: await prisma.message.count({ where: { chatRoomId: room.id } }),
  hidden: await prisma.message.count({ where: { chatRoomId: room.id, hiddenAt: { not: null } } }),
  outsiderCursor: await prisma.chatRead.count({ where: { userId: users[2].id } }),
  bExists: Boolean(await prisma.user.findFirst({ where: { id: users[1].id, email: `${marker}-1@test.example.invalid` } })),
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

try {
  await new Promise((resolve, reject) => { const p = createServer(); p.once("error", reject); p.listen(PORT, "127.0.0.1", () => p.close(resolve)); });
  for (let i = 0; i < 3; i++) {
    const user = await prisma.user.create({ data: { email: `${marker}-${i}@test.example.invalid`, name: "Synthetic csrf", nickname: `Csrf ${i}`, privacyConsentAt: new Date(), privacyConsentVersion: terms.CURRENT_PRIVACY_VERSION, termsAcceptedAt: new Date(), termsVersion: terms.CURRENT_TERMS_VERSION, identityConsentVersion: terms.CURRENT_IDENTITY_CONSENT_VERSION } });
    users.push(user); save();
    await prisma.userIdentityInfo.create({ data: { userId: user.id, realName: "Synthetic", department: "Synthetic", consentVersion: terms.CURRENT_IDENTITY_CONSENT_VERSION, consentedAt: new Date() } });
    sessions.push(await encode({ token: { sub: String(user.id), userId: user.id, nickname: user.nickname, realtimeSessionId: randomUUID() }, secret, salt: "authjs.session-token" }));
  }
  room = await prisma.chatRoom.create({ data: { initiatorUserId: users[0].id, counterpartUserId: users[1].id, postType: "lost", postTitle: marker } }); save();
  for (let i = 0; i < 3; i++) {
    const m = await prisma.message.create({ data: { chatRoomId: room.id, senderUserId: users[0].id, content: `synthetic ${i}` } });
    messageIds.push(m.id);
    await prisma.notification.create({ data: { userId: users[1].id, type: "MESSAGE", title: "synthetic", content: "synthetic", relatedType: "message", relatedId: m.id } });
  }

  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], { env: { ...process.env, AUTH_SECRET: secret, AUTH_TRUST_HOST: "true" }, stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + "/api/version", { signal: AbortSignal.timeout(1000) })).ok) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }

  const r = room.id, json = { "content-type": "application/json" };
  const evil = { origin: "https://evil.example" }, xsite = { "sec-fetch-site": "cross-site", origin: "https://evil.example" };
  const readBody = JSON.stringify({ upToMessageId: messageIds[2] });
  const before = await state();
  check("fixture: B has 3 unread, no cursor", before.unread === 3 && before.cursor === null, { before });

  // ---- Part 1: forged headers with B's real cookie ----
  const forged = [
    ["POST read, Sec-Fetch-Site cross-site", 1, "POST", `/api/chat/${r}/read`, { ...json, ...xsite }, readBody],
    ["POST read, foreign Origin only", 1, "POST", `/api/chat/${r}/read`, { ...json, ...evil }, readBody],
    ["POST read, Origin null", 1, "POST", `/api/chat/${r}/read`, { ...json, origin: "null" }, readBody],
    ["POST read, Sec-Fetch-Site same-site", 1, "POST", `/api/chat/${r}/read`, { ...json, "sec-fetch-site": "same-site" }, readBody],
    ["POST read, text/plain form shape", 1, "POST", `/api/chat/${r}/read`, { "content-type": "text/plain", ...xsite }, readBody],
    ["POST read, look-alike origin", 1, "POST", `/api/chat/${r}/read`, { ...json, origin: `${base}.evil.example` }, readBody],
    ["POST message cross-site", 1, "POST", `/api/chat/${r}/messages`, { ...json, ...xsite }, JSON.stringify({ content: "csrf" })],
    ["DELETE message cross-site", 0, "DELETE", `/api/chat/${r}/messages?messageId=${messageIds[0]}`, xsite, undefined],
    ["PATCH notification cross-site", 1, "PATCH", `/api/notifications/0`, { ...json, ...xsite }, "{}"],
    ["POST notifications read-all cross-site", 1, "POST", `/api/notifications/read-all`, xsite, undefined],
    ["POST withdraw cross-site", 1, "POST", `/api/me/withdraw`, { ...json, ...xsite }, "{}"],
    ["POST read cross-site without a session", null, "POST", `/api/chat/${r}/read`, { ...json, ...xsite }, readBody],
  ];
  for (const [name, who, method, path, headers, body] of forged) {
    const status = await call(who, method, path, { headers, body });
    check(`refused: ${name}`, status === 403, { status });
  }
  const afterForged = await state();
  check("nothing changed after forged requests", same(before, afterForged), { afterForged });

  // GET with the cookie, as a cross-site top-level navigation would send it.
  const getStatus = await call(1, "GET", `/api/chat/${r}/messages`, { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } });
  const afterGet = await state();
  check("cross-site GET messages reads (200) without marking read (P-3)", getStatus === 200 && same(before, afterGet), { status: getStatus, afterGet });

  // Outsider C (a real member, wrong room), same-origin.
  const outsider = await call(2, "POST", `/api/chat/${r}/read`, { headers: { ...json, "sec-fetch-site": "same-origin", origin: base }, body: readBody });
  check("outsider C cannot mark the room read", (outsider === 403 || outsider === 404) && (await state()).outsiderCursor === 0, { status: outsider });

  // ---- Part 2: real browsers on an attacker site ----
  const attackPage = `<!doctype html><title>x</title>
<form id="f" method="POST" action="${base}/api/chat/${r}/read" enctype="text/plain"><input name='{"upToMessageId":${messageIds[2]},"x":"' value='"}'></form>
<iframe name="sink" style="display:none"></iframe>
<script>
fetch("${base}/api/chat/${r}/read",{method:"POST",mode:"no-cors",credentials:"include",headers:{"content-type":"text/plain"},body:'${readBody}'}).catch(()=>{});
new Image().src="${base}/api/chat/${r}/messages";
document.getElementById("f").target="sink";
setTimeout(()=>document.getElementById("f").submit(),300);
setTimeout(()=>{location.href="${base}/api/chat/${r}/messages";},2500);
</script>`;
  attackerServer = createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(attackPage); });
  await new Promise((resolve) => attackerServer.listen(ATTACKER_PORT, "127.0.0.1", resolve));
  const browser = spawn("python", ["scripts/regression/csrf-browser.py"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, timeout: 180000 });
  browser.stdin.end(JSON.stringify({ base, attacker, roomId: r, cookie: sessions[1] }));
  let out = ""; browser.stdout.on("data", (d) => { out += d; }); browser.stderr.resume();
  const [code] = await once(browser, "close");
  let browserResult = null; try { browserResult = JSON.parse(out); } catch {}
  check("browser attack page ran (Chromium + WebKit)", code === 0 && browserResult?.passed, { browser: browserResult });
  const afterBrowser = await state();
  check("attacker site moved nothing (cursor, notifications, messages)", same(before, afterBrowser), { afterBrowser });

  // ---- Same-origin still works (no false 403) ----
  const own = await call(1, "POST", `/api/chat/${r}/read`, { headers: { ...json, "sec-fetch-site": "same-origin", origin: base }, body: JSON.stringify({ upToMessageId: messageIds[1] }) });
  const afterOwn = await state();
  check("same-origin POST read marks up to the shown message only (cursor and notifications)", own === 200 && afterOwn.cursor === messageIds[1] && afterOwn.unread === 1, { status: own, afterOwn });
  const noHeaders = await call(1, "POST", `/api/chat/${r}/read`, { headers: json, body: readBody });
  const afterAll = await state();
  check("non-browser client (no Origin/Sec-Fetch-Site) still reaches auth and works", noHeaders === 200 && afterAll.cursor === messageIds[2] && afterAll.unread === 0, { status: noHeaders });
} catch (error) {
  check("suite ran", false, { error: error?.name ?? "error" });
} finally {
  server?.kill();
  attackerServer?.close();
  try {
    for (const [i, u] of users.entries()) if ((await prisma.user.findUnique({ where: { id: u.id } }))?.email !== `${marker}-${i}@test.example.invalid`) throw new Error("Fixture ownership differs");
    if (room) { const rr = await prisma.chatRoom.findUnique({ where: { id: room.id } }); if (rr?.postTitle !== marker) throw new Error("Room ownership differs"); }
    await prisma.$transaction(async (tx) => {
      if (room) await tx.chatRoom.delete({ where: { id: room.id } });
      for (const u of users) {
        await tx.notification.deleteMany({ where: { userId: u.id } });
        await tx.rateLimitCounter.deleteMany({ where: { OR: ["chatSync", "chatMessage"].map((a) => ({ key: { startsWith: `${a}:u:${u.id}:` } })) } });
        await tx.user.delete({ where: { id: u.id } });
      }
    });
    cleanupOk = true;
  } catch { console.error("Fixture cleanup failed; keep recorded IDs"); }
  const passed = checks.length > 0 && checks.every((c) => c.ok) && cleanupOk;
  console.log(JSON.stringify({ suite: "csrf-local", passed, total: checks.length, failed: checks.filter((c) => !c.ok).length, checks, cleanupOk, userIds: users.map((u) => u.id), roomId: room?.id }, null, 1));
  await prisma.$disconnect();
  process.exit(passed ? 0 : 1);
}
