// D-4 CSP browser check on a LOCAL build against the Preview database.
// Build first with the CSP switched on (it is read at build time):
//   MJU_CSP_MODE=enforce node scripts/regression/build-preview.mjs --confirm-preview
//   node --env-file=.vercel/regression-preview.env --env-file=.env.preview.local scripts/regression/csp-browser.mjs --confirm-preview
// Creates one synthetic member (no posts) for the signed-in pages and removes
// it; reads one existing Preview photo post read-only. Rebuild without
// MJU_CSP_MODE afterwards for other regressions.
import "../db/install-guard.mjs";
import { assertDatabaseEnvironment, assertScriptSupabaseAccess } from "../../src/lib/db/accessPolicy.mjs";
import { createJiti } from "jiti";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
if (!process.argv.includes("--confirm-preview") || assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview" || assertScriptSupabaseAccess(process.env) !== "preview") throw new Error("Preview confirmation required");
process.env.AUTH_SECRET = randomUUID() + randomUUID(); // local child server only
const require = createRequire(import.meta.url);
const { encode } = await import(pathToFileURL(require.resolve("@auth/core/jwt")));
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } });
const { prisma } = await jiti.import("../../src/lib/db/prisma.ts");
const terms = await jiti.import("../../src/lib/auth/terms.ts");
const PORT = 3108;
const marker = `regression-${randomUUID()}`;
const email = `${marker}-0@regression.example.invalid`;
let user, server, ok = false;
try {
  await new Promise((resolve, reject) => { const probe = createServer(); probe.once("error", reject); probe.listen(PORT, "127.0.0.1", () => probe.close(resolve)); });
  const post = (await prisma.$queryRaw`SELECT 'found' AS type, id, image_url AS "imageUrl" FROM "FoundPost" WHERE image_url IS NOT NULL AND removed_at IS NULL AND temp_hidden_at IS NULL ORDER BY id DESC LIMIT 1`)[0];
  if (!post) throw new Error("No Preview photo post to view");
  user = await prisma.user.create({ data: { email, name: "Regression fixture", nickname: "Regression fixture", privacyConsentAt: new Date(), privacyConsentVersion: terms.CURRENT_PRIVACY_VERSION, termsAcceptedAt: new Date(), termsVersion: terms.CURRENT_TERMS_VERSION, identityConsentVersion: terms.CURRENT_IDENTITY_CONSENT_VERSION } });
  console.error(`fixture user id=${user.id} marker=${marker}`);
  await prisma.userIdentityInfo.create({ data: { userId: user.id, realName: "Synthetic test", department: "Synthetic department", consentVersion: terms.CURRENT_IDENTITY_CONSENT_VERSION, consentedAt: new Date() } });
  const jwt = await encode({ token: { sub: String(user.id), userId: user.id, nickname: user.nickname, realtimeSessionId: randomUUID() }, secret: process.env.AUTH_SECRET, salt: "authjs.session-token" });
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], { env: { ...process.env, AUTH_TRUST_HOST: "true" }, windowsHide: true, stdio: "ignore" });
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/version`)).status === 200) break; } catch {}
    if (i === 29) throw new Error("Local server did not start");
    await new Promise((r) => setTimeout(r, 1000));
  }
  const py = spawnSync("python", ["-I", "scripts/regression/csp-browser.py"], { env: { ...process.env, CSP_BASE: `http://127.0.0.1:${PORT}`, CSP_SESSION: jwt, CSP_POST: JSON.stringify(post), CSP_PHOTO: "docs/ai-eval-seed/query-images/R12.jpg", PYTHONUTF8: "1" }, stdio: "inherit", timeout: 600000 });
  ok = py.status === 0;
} finally {
  server?.kill();
  try {
    if (user) {
      if ((await prisma.user.findUnique({ where: { id: user.id } }))?.email !== email) throw new Error("ownership mismatch");
      await prisma.$transaction(async (tx) => {
        await tx.userIdentityInfo.deleteMany({ where: { userId: user.id } });
        await tx.rateLimitCounter.deleteMany({ where: { OR: ["aiSearch", "imageUpload", "postCreate", "chatMessage", "chatSync", "realtimeToken"].map((a) => ({ key: { startsWith: `${a}:u:${user.id}:` } })) } });
        await tx.user.delete({ where: { id: user.id } });
      }, { timeout: 10000 });
      console.error(`fixture user ${user.id} removed`);
    }
  } catch (e) { console.error("Fixture cleanup failed; remove user", user?.id, "manually:", e.message); process.exitCode = 1; }
  await prisma.$disconnect();
}
process.exit(ok ? (process.exitCode ?? 0) : 1);
