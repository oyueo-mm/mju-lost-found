// Security audit 2026-11-21 (A-1): comments of a temporarily hidden or
// removed post must not be readable by anyone who may not see the post.
//
//   node --env-file=.env.preview.local scripts/regression/hidden-post-comments.mjs --confirm-preview <preview deployment url>
//
// Preview DB only. Creates one synthetic member, one lost post and one
// comment (marker in .vercel/hidden-comments-<uuid>.json), then reads
// GET /api/posts/<id>/comments, the post page and the newest-first list
// anonymously on the given deployment in three states: visible (expect the
// comment on the API and the page, the post in the list), temp-hidden and
// removed (expect API 404, no comment text on the page, not listed). No
// response may carry a shared-cache Cache-Control. Deletes everything it created. Prints statuses and
// whether the marker text came back -- never other content.
import "../db/install-guard.mjs";
import { assertDatabaseEnvironment, assertScriptSupabaseAccess } from "../../src/lib/db/accessPolicy.mjs";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const base = process.argv.find((a) => /^https:\/\/mju-lost-found-vercel-[a-z0-9]+-oyueo\.vercel\.app$/.test(a));
if (!process.argv.includes("--confirm-preview") || !base || assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview" || assertScriptSupabaseAccess(process.env) !== "preview") {
  throw new Error("usage: --confirm-preview <preview deployment url> with the Preview env");
}
const project = spawnSync("npx --no-install vercel api /v9/projects/prj_zMYrrsw80l829lSjs2n2Ur6YV5eP", { shell: true, encoding: "utf8", windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 1 << 22 });
const key = Object.entries(JSON.parse(project.stdout.slice(project.stdout.indexOf("{"))).protectionBypass ?? {}).find(([, v]) => v?.scope === "automation-bypass")?.[0];
if (!key) throw new Error("automation bypass key unavailable");

const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } });
const { prisma } = await jiti.import("../../src/lib/db/prisma.ts");
const marker = `hidden-comments-${randomUUID()}`;
const secretText = `${marker}-comment-text`;
let user, post, cleanupOk = false;
const checks = [];
const save = () => writeFileSync(`.vercel/${marker}.json`, JSON.stringify({ marker, userId: user?.id, lostPostId: post?.id }));
const get = (path) => fetch(`${base}${path}`, { headers: { "x-vercel-protection-bypass": key } });
// Comments API, the post page (comment section + count) and the newest-first
// list (title, comment count). Also records whether any response is marked
// cacheable by a shared cache, which would let a hidden state be served stale.
const read = async () => {
  const res = await get(`/api/posts/${post.id}/comments?type=lost`);
  const text = await res.text();
  const page = await get(`/post/${post.id}?type=lost`);
  const pageText = await page.text();
  const list = await get(`/api/posts?type=lost&limit=50`);
  const listText = await list.text();
  const publicCache = [res, page, list].some((r) => /public|s-maxage/i.test(r.headers.get("cache-control") ?? ""));
  return {
    status: res.status, leaked: text.includes(secretText),
    pageStatus: page.status, pageLeaked: pageText.includes(secretText),
    listStatus: list.status, listed: listText.includes(marker),
    publicCache,
  };
};
const hiddenOk = (r) => r.status === 404 && !r.leaked && !r.pageLeaked && r.listStatus === 200 && !r.listed && !r.publicCache;
try {
  user = await prisma.user.create({ data: { email: `${marker}@test.example.invalid`, name: "Synthetic audit", nickname: `Audit ${marker.slice(-6)}` } });
  save();
  post = await prisma.lostPost.create({ data: { userId: user.id, title: marker, description: "synthetic audit post", category: "기타" } });
  save();
  await prisma.comment.create({ data: { lostPostId: post.id, authorUserId: user.id, content: secretText } });

  const visible = await read();
  checks.push({ name: "visible post: comments readable (control)", ok: visible.status === 200 && visible.leaked && visible.pageLeaked && visible.listed && !visible.publicCache, ...visible });
  await prisma.lostPost.update({ where: { id: post.id }, data: { tempHiddenAt: new Date() } });
  const hidden = await read();
  checks.push({ name: "temp-hidden post: anonymous comment read refused", ok: hiddenOk(hidden), ...hidden });
  await prisma.lostPost.update({ where: { id: post.id }, data: { tempHiddenAt: null, removedAt: new Date() } });
  const removed = await read();
  checks.push({ name: "removed post: anonymous comment read refused", ok: hiddenOk(removed), ...removed });
} catch (error) {
  checks.push({ name: "suite ran", ok: false, error: error?.name ?? "error" });
} finally {
  try {
    if (post) { const p = await prisma.lostPost.findUnique({ where: { id: post.id } }); if (p && p.title !== marker) throw new Error("ownership"); if (p) await prisma.lostPost.delete({ where: { id: post.id } }); }
    if (user) { const u = await prisma.user.findUnique({ where: { id: user.id } }); if (u && u.email !== `${marker}@test.example.invalid`) throw new Error("ownership"); if (u) await prisma.user.delete({ where: { id: user.id } }); }
    cleanupOk = true;
  } catch { console.error("cleanup failed; see the recorded IDs"); }
  const passed = checks.length === 3 && checks.every((c) => c.ok) && cleanupOk;
  console.log(JSON.stringify({ suite: "hidden-post-comments", base, passed, checks, cleanupOk, userId: user?.id, lostPostId: post?.id }, null, 1));
  await prisma.$disconnect();
  process.exit(passed ? 0 : 1);
}
