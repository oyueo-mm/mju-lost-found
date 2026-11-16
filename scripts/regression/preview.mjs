// Adapted from the historical 16-step audit/regress.mjs. Never use seed users.
import "../db/install-guard.mjs";
import { assertDatabaseEnvironment, PREVIEW_DB_PROJECT } from "../../src/lib/db/accessPolicy.mjs";
import { createJiti } from "jiti";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { RealtimeClient } from "@supabase/realtime-js";
import sharp from "sharp";

// Both the database and Storage must be Preview. No arbitrary target URL.
if (!process.argv.includes("--confirm-preview") || assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview") throw new Error("Explicit Preview environment and --confirm-preview required");
const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (new URL(storageUrl).hostname !== `${PREVIEW_DB_PROJECT}.supabase.co`) throw new Error("Preview Storage required");
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!publicKey || publicKey === "[SENSITIVE]" || !process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY === "[SENSITIVE]") throw new Error("Preview configuration missing");
// D3 receive must be proved through the real private channel. Never replace
// step 11 with a public-channel or polling success to hide missing trust.
if((!process.env.MJU_REALTIME_PRIVATE_JWK||process.env.MJU_REALTIME_PRIVATE_JWK==="[SENSITIVE]")&&!process.argv.includes("--cleanup-run"))throw new Error("D3 regression requires the approved Preview signing configuration and private mode");
// A fresh signing secret belongs only to this local child server. No deployed
// login secret is needed or changed; these cookies cannot log into Vercel.
process.env.AUTH_SECRET = randomUUID() + randomUUID();
const require = createRequire(import.meta.url);
const { encode } = await import(pathToFileURL(require.resolve("@auth/core/jwt")));
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } });
const { prisma } = await jiti.import("../../src/lib/db/prisma.ts");
const terms = await jiti.import("../../src/lib/auth/terms.ts");
const browser = createClient(storageUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
const storage = createClient(storageUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const base = "http://localhost:3100";
const cleanupIndex = process.argv.indexOf("--cleanup-run");
const saved = cleanupIndex >= 0 ? JSON.parse(readFileSync(process.argv[cleanupIndex + 1], "utf8")) : null;
const marker = saved?.marker ?? `regression-${randomUUID()}`;
if (!/^regression-[0-9a-f-]{36}$/.test(marker)) throw new Error("Invalid fixture marker");
const users = saved?.users ?? [], cookies = [], objects = saved?.objects ?? [], results = [];
let postId = saved?.postId, roomId = saved?.roomId, server, subscriber, cleanupOk = false;
mkdirSync(".vercel", { recursive: true });
const manifest = `.vercel/${marker}.json`;
function save() { writeFileSync(manifest, JSON.stringify({ marker, users: users.map(u => ({ id: u.id, email: u.email })), postId, roomId, objects })); }
const must = (ok) => { if (!ok) throw new Error("Assertion failed"); };
async function api(actor, method, path, body) {
  const headers = actor === null ? {} : { cookie: cookies[actor] };
  if(method==="POST")headers.origin=new URL(base).origin;
  if (body !== undefined && !(body instanceof FormData)) headers["content-type"] = "application/json";
  const r = await fetch(base + path, { method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(120000) });
  const json = r.headers.get("content-type")?.includes("application/json") ? await r.json() : (await r.arrayBuffer(), null);
  return { status: r.status, json, data: json?.data ?? json, location: r.headers.get("location") };
}
async function step(name, fn) {
  const start = Date.now();
  try { await fn(); results.push({ name, passed: true, ms: Date.now() - start }); }
  catch { results.push({ name, passed: false, ms: Date.now() - start }); throw new Error(`Step failed: ${name}`); }
}
async function upload(actor, bucket, path, body) {
  const r = await api(actor, "POST", path, body);
  must(r.status === 200 && r.data?.token);
  const prefix = bucket === "post-images" ? `posts/lost/${postId}/` : `chat/${roomId}/`;
  must(r.data.path.startsWith(prefix));
  objects.push({ bucket, path: r.data.path }); // Track before upload, even if it fails.
  save();
  const { error } = await browser.storage.from(bucket).uploadToSignedUrl(r.data.path, r.data.token, new Blob([jpeg], { type: "image/jpeg" }), { contentType: "image/jpeg" });
  must(!error);
  return r.data.path;
}
const jpeg = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer();
try {
  if (saved) throw new Error("Cleanup-only run");
  // Never connect to an already-running/unknown process on this port.
  const { createServer } = await import("node:net");
  await new Promise((resolve, reject) => { const probe = createServer(); probe.once("error", reject); probe.listen(3100, "127.0.0.1", () => probe.close(resolve)); });
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3100"], { env: { ...process.env, AUTH_TRUST_HOST: "true" }, windowsHide: true, stdio: "ignore" });
  for (let i = 0; ; i++) {
    try { if ((await api(null, "GET", "/api/version")).status === 200) break; } catch {}
    if (i === 29) throw new Error("Local server did not start");
    await new Promise(r => setTimeout(r, 1000));
  }
  await step("01 health: home, login, version", async () => { for (const p of ["/", "/login", "/api/version"]) must((await api(null, "GET", p)).status === 200); });
  await step("02 anonymous authentication", async () => must((await api(null, "GET", "/api/chat")).status === 401));
  await step("03 isolated sessions: two members and administrator", async () => {
    for (let i = 0; i < 3; i++) {
      const user = await prisma.user.create({ data: { email: `${marker}-${i}@regression.example.invalid`, name: "Regression fixture", nickname: "Regression fixture", isAdmin: i === 2, privacyConsentAt: new Date(), privacyConsentVersion: terms.CURRENT_PRIVACY_VERSION, termsAcceptedAt: new Date(), termsVersion: terms.CURRENT_TERMS_VERSION, identityConsentVersion: terms.CURRENT_IDENTITY_CONSENT_VERSION } });
      users.push(user);
      save();
      const jwt = await encode({ token: { sub: String(user.id), userId: user.id, nickname: user.nickname,realtimeSessionId:randomUUID() }, secret: process.env.AUTH_SECRET, salt: "authjs.session-token" });
      cookies.push(`authjs.session-token=${jwt}`);
      must(String((await api(i, "GET", "/api/auth/session")).json?.user?.id) === String(user.id));
    }
  });
  await step("04 identity and consent readiness", async () => {
    for (const user of users) await prisma.userIdentityInfo.create({ data: { userId: user.id, realName: "Synthetic test", department: "Synthetic department", consentVersion: terms.CURRENT_IDENTITY_CONSENT_VERSION, consentedAt: new Date() } });
    must((await api(0, "POST", "/api/chat", { postType: "lost", postId: 2147483647 })).json?.code !== "identity_required");
  });
  await step("05 create post", async () => {
    const r = await api(0, "POST", "/api/posts", { type: "lost", title: marker, description: "Isolated regression fixture, removed after verification.", category: "기타", location: "Synthetic test", campus: "인문캠퍼스", lostDate: new Date().toISOString().slice(0, 10) });
    must(r.status === 200 || r.status === 201); postId = r.data?.id; must(postId); save();
  });
  await step("06 signed post image upload and attach", async () => {
    const path = await upload(0, "post-images", "/api/upload", { postType: "lost", postId, contentType: "image/jpeg" });
    must((await api(0, "POST", `/api/posts/${postId}/image?type=lost`, { paths: [path] })).status === 200);
    const r = await fetch(`${storageUrl}/storage/v1/object/public/post-images/${path}`); must(r.ok); await r.body?.cancel();
  });
  await step("07 post API and page", async () => {
    must((await api(null, "GET", `/api/posts/${postId}?type=lost`)).status === 200);
    must((await api(null, "GET", `/post/${postId}?type=lost`)).status === 200);
  });
  await step("08 image embedding recompute", async () => {
    // The attach after() may already own the lease. Wait for actual completion,
    // never accept in_progress/pending as a successful embedding test.
    let completed=false;
    for(let i=0;i<30;i++){
      const r=await api(0,"PUT",`/api/posts/${postId}?type=lost`);must(r.status===200);
      if(r.data?.embedded===true){completed=true;break;}
      must(["in_progress","pending"].includes(r.data?.jobStatus));
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    must(completed);
    const vector=(await prisma.$queryRaw`SELECT vector_dims(p."imageEmbedding") AS dimensions,j.state,j.desired_hash=j.completed_hash AS current FROM "LostPost" p JOIN "ImageEmbeddingJob" j ON j.post_type='lost' AND j.post_id=p.id WHERE p.id=${postId}`)[0];
    must(vector?.dimensions===768&&vector.state==="completed"&&vector.current===true);
  });
  await step("09 keyword, semantic, unified, image search", async () => {
    for (const mode of ["keyword", "semantic", "unified"]) {
      const r = await api(1, "GET", `/api/posts?type=lost&mode=${mode}&q=${encodeURIComponent(marker)}`);
      must(r.status === 200 && Array.isArray(r.data));
      if (mode === "keyword") must(r.data.some(p => p.id === postId));
    }
    const form = new FormData(); form.set("image", new Blob([jpeg], { type: "image/jpeg" }), "test.jpg");
    const r = await api(1, "POST", "/api/posts?type=lost&mode=image", form);
    must(r.status === 200 && Array.isArray(r.data)); // Historical script accepted 502 here; this does not.
  });
  await step("10 create chat room", async () => {
    const r = await api(1, "POST", "/api/chat", { postType: "lost", postId }); must(r.status === 200 || r.status === 201); roomId = r.data?.id; must(roomId); save();
  });
  await step("11 message send and Realtime receive", async () => {
    const issued=await api(0,"POST",`/api/chat/${roomId}/realtime`);
    must(issued.status===200&&issued.json?.token&&issued.json?.topic?.startsWith("mju-chat:"));
    subscriber = new RealtimeClient(`${storageUrl}/realtime/v1`,{params:{apikey:publicKey}});
    await subscriber.setAuth(issued.json.token);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Realtime timeout")), 15000);
      subscriber.channel(issued.json.topic,{config:{private:true}}).on("broadcast", { event: "message" }, ({payload}) => { if(!Number.isSafeInteger(payload?.messageId)||typeof payload.eventId!=="string")return;clearTimeout(timer); resolve(); }).subscribe(async status => {
        if (status === "SUBSCRIBED") { try { const r = await api(1, "POST", `/api/chat/${roomId}/messages`, { content: marker }); must(r.status === 200 || r.status === 201); } catch { clearTimeout(timer); reject(new Error("Message failed")); } }
      });
    });
    await subscriber.removeAllChannels();
  });
  await step("12 private chat image upload, view, outsider denial", async () => {
    const path = await upload(1, "chat-images", `/api/chat/${roomId}/upload`, { contentType: "image/jpeg" });
    const m = await api(1, "POST", `/api/chat/${roomId}/messages`, { imagePath: path }); must(m.status === 200 || m.status === 201);
    const p = `/api/chat/${roomId}/messages/${m.data.id}/image`;
    const r = await api(0, "GET", p); must(r.status === 302 && r.location);
    const image = await fetch(r.location); must(image.ok); await image.body?.cancel();
    must((await api(2, "GET", p)).status === 403);
    const listed = await browser.storage.from("chat-images").list(`chat/${roomId}`); must(!listed.data?.length);
  });
  await step("13 notifications generated and marked read", async () => {
    const r = await api(0, "GET", "/api/notifications"); must(r.status === 200 && r.data.some(n => n.type === "message"));
    must((await api(0, "POST", "/api/notifications/read-all")).status === 200);
    const after = await api(0, "GET", "/api/notifications/unread-count"); must(after.status === 200 && after.data.count === 0);
  });
  await step("14 chat participant read and outsider denial", async () => {
    must((await api(0, "GET", `/api/chat/${roomId}/messages`)).status === 200);
    must((await api(2, "GET", `/api/chat/${roomId}`)).status === 403);
  });
  await step("15 administrator APIs/page and non-admin denial", async () => {
    for (const path of ["/api/admin/reports", "/api/admin/users", "/api/admin/posts?type=lost", "/admin"]) must((await api(2, "GET", path)).status === 200);
    must((await api(0, "GET", "/api/admin/users")).status === 403);
  });
  await step("16 delete post and confirm public image removal", async () => {
    const object = objects.find(o => o.bucket === "post-images");
    async function originExists() {
      const slash = object.path.lastIndexOf("/");
      const name = object.path.slice(slash + 1);
      const r = await storage.storage.from("post-images").list(object.path.slice(0, slash), { search: name, limit: 100 });
      must(!r.error && Array.isArray(r.data));
      return r.data.some(item => item.name === name);
    }
    must(await originExists());
    must([200, 204].includes((await api(0, "DELETE", `/api/posts/${postId}?type=lost`)).status));
    let absent = false;
    for (let i = 0; i < 10; i++) { if (!(await originExists())) { absent = true; break; } await new Promise(r => setTimeout(r, 500)); }
    must(absent && !(await prisma.lostPost.findUnique({ where: { id: postId } })));
    // Public CDN caches can temporarily return a previously fetched image.
    // Require authoritative Storage absence and record CDN behavior separately.
    const publicResponse = await fetch(`${storageUrl}/storage/v1/object/public/post-images/${object.path}`);
    console.log(JSON.stringify({ check: "deleted image", storageAbsent: absent, publicCdnStatus: publicResponse.status }));
    await publicResponse.body?.cancel();
  });
} catch (error) {
  if (!saved) { console.error(error.message.startsWith("Step failed:") ? error.message : "Regression setup failed; no sensitive details emitted"); process.exitCode = 1; }
} finally {
  try {
    await subscriber?.removeAllChannels(); await browser.removeAllChannels();
    // Verify ownership before any cleanup; never delete by title or broad time range.
    for (const [i, user] of users.entries()) must((await prisma.user.findUnique({ where: { id: user.id } }))?.email === user.email && user.email === `${marker}-${i}@regression.example.invalid`);
    if (postId) must((await prisma.lostPost.findUnique({ where: { id: postId } }))?.userId === users[0].id || !(await prisma.lostPost.findUnique({ where: { id: postId } })));
    if (roomId) { const room = await prisma.chatRoom.findUnique({ where: { id: roomId } }); must(room?.initiatorUserId === users[1].id && room?.counterpartUserId === users[0].id && room?.postTitle === marker); }
    for (const object of objects) { const prefix = object.bucket === "post-images" ? `posts/lost/${postId}/` : `chat/${roomId}/`; must(object.path.startsWith(prefix)); const { error } = await storage.storage.from(object.bucket).remove([object.path]); must(!error); }
    const { deletePostRowInTx } = await jiti.import("../../src/lib/posts/service.ts");
    await prisma.$transaction(async tx => {
      if (roomId) await tx.chatRoom.delete({ where: { id: roomId } });
      if (postId) await deletePostRowInTx(tx, "lost", postId);
      for (const user of users) {
        await tx.notification.deleteMany({ where: { userId: user.id } });
        await tx.rateLimitCounter.deleteMany({ where: { OR: ["aiSearch", "imageUpload", "postCreate", "chatMessage","chatSync","realtimeToken"].map(a => ({ key: { startsWith: `${a}:u:${user.id}:` } })) } });
        await tx.user.delete({ where: { id: user.id } });
      }
    }, { timeout: 10000 });
    cleanupOk = true;
  } catch { console.error("Fixture cleanup failed; preserve run IDs for operator review"); process.exitCode = 1; }
  server?.kill(); await prisma.$disconnect();
  console.log(JSON.stringify({ suite: "preview-regression-16", passed: results.filter(r => r.passed).length, total: 16, executed: results.length, cleanupOk, fixtures: { userIds: users.map(u => u.id), postId, roomId }, results }, null, 2));
}
// Imported inference runtimes can keep native worker threads alive in Node.
// All operations and cleanup above have finished before this explicit exit.
process.exit(process.exitCode ?? 0);
