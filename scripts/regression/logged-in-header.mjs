// Signed-in common-header check on a LOCAL build against the Preview database.
// Creates one isolated synthetic member (+ one unread notification so the
// badge is on screen), runs logged-in-header.py through Chromium, then deletes
// everything it created. Never touches existing users or Production.
//
//   node scripts/regression/build-preview.mjs --confirm-preview
//   node --env-file=.vercel/regression-preview.env --env-file=.env.preview.local \
//        scripts/regression/logged-in-header.mjs --confirm-preview
import "../db/install-guard.mjs";
import { assertDatabaseEnvironment, assertScriptSupabaseAccess } from "../../src/lib/db/accessPolicy.mjs";
import { createJiti } from "jiti";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

if (!process.argv.includes("--confirm-preview") || assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview" || assertScriptSupabaseAccess(process.env) !== "preview") throw new Error("Preview confirmation required");
// Fresh signing secret for this local child server only; the cookie cannot log into any deployment.
process.env.AUTH_SECRET = randomUUID() + randomUUID();
const require = createRequire(import.meta.url);
const { encode } = await import(pathToFileURL(require.resolve("@auth/core/jwt")));
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } });
const { prisma } = await jiti.import("../../src/lib/db/prisma.ts");
const terms = await jiti.import("../../src/lib/auth/terms.ts");

const PORT = 3107;
const marker = `regression-${randomUUID()}`;
const email = `${marker}-0@regression.example.invalid`;
let user, server, ok = false;
try {
  await new Promise((resolve, reject) => { const probe = createServer(); probe.once("error", reject); probe.listen(PORT, "127.0.0.1", () => probe.close(resolve)); });
  user = await prisma.user.create({ data: { email, name: "Regression fixture", nickname: "Regression fixture", privacyConsentAt: new Date(), privacyConsentVersion: terms.CURRENT_PRIVACY_VERSION, termsAcceptedAt: new Date(), termsVersion: terms.CURRENT_TERMS_VERSION, identityConsentVersion: terms.CURRENT_IDENTITY_CONSENT_VERSION } });
  console.error(`fixture user id=${user.id} marker=${marker}`);
  await prisma.userIdentityInfo.create({ data: { userId: user.id, realName: "Synthetic test", department: "Synthetic department", consentVersion: terms.CURRENT_IDENTITY_CONSENT_VERSION, consentedAt: new Date() } });
  await prisma.notification.create({ data: { userId: user.id, type: "MATCH", title: "Synthetic notification", content: "Synthetic fixture, removed after verification.", isRead: false } });
  const jwt = await encode({ token: { sub: String(user.id), userId: user.id, nickname: user.nickname, realtimeSessionId: randomUUID() }, secret: process.env.AUTH_SECRET, salt: "authjs.session-token" });
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], { env: { ...process.env, AUTH_TRUST_HOST: "true" }, windowsHide: true, stdio: "ignore" });
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/version`)).status === 200) break; } catch {}
    if (i === 29) throw new Error("Local server did not start");
    await new Promise((r) => setTimeout(r, 1000));
  }
  const py = spawnSync("python", ["-I", "scripts/regression/logged-in-header.py"], { env: { ...process.env, HEADER_BASE: `http://127.0.0.1:${PORT}`, HEADER_SESSION: jwt, PYTHONUTF8: "1" }, stdio: "inherit" });
  ok = py.status === 0;
} finally {
  server?.kill();
  try {
    if (user) {
      if ((await prisma.user.findUnique({ where: { id: user.id } }))?.email !== email) throw new Error("ownership mismatch");
      await prisma.$transaction(async (tx) => {
        await tx.notification.deleteMany({ where: { userId: user.id } });
        await tx.rateLimitCounter.deleteMany({ where: { OR: ["aiSearch", "imageUpload", "postCreate", "chatMessage", "chatSync", "realtimeToken"].map((a) => ({ key: { startsWith: `${a}:u:${user.id}:` } })) } });
        await tx.user.delete({ where: { id: user.id } });
      }, { timeout: 10000 });
      console.error(`fixture user ${user.id} removed`);
    }
  } catch (e) { console.error("Fixture cleanup failed; remove user", user?.id, "manually:", e.message); process.exitCode = 1; }
  await prisma.$disconnect();
}
process.exit(ok ? (process.exitCode ?? 0) : 1);
