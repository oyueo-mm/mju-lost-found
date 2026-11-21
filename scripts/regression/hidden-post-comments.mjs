// Security audit 2026-11-21 (A-1): comments of a temporarily hidden or
// removed post must not be readable by anyone who may not see the post.
//
//   node --env-file=.env.preview.local scripts/regression/hidden-post-comments.mjs --confirm-preview <preview deployment url>
//
// Preview DB only. Creates one synthetic member, one lost post and one
// comment (marker in .vercel/hidden-comments-<uuid>.json), then reads
// GET /api/posts/<id>/comments anonymously on the given deployment in three
// states: visible (expect 200 + the comment), temp-hidden (expect 404) and
// removed (expect 404). Deletes everything it created. Prints statuses and
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
const read = async () => {
  const res = await fetch(`${base}/api/posts/${post.id}/comments?type=lost`, { headers: { "x-vercel-protection-bypass": key } });
  const text = await res.text();
  return { status: res.status, leaked: text.includes(secretText) };
};
try {
  user = await prisma.user.create({ data: { email: `${marker}@test.example.invalid`, name: "Synthetic audit", nickname: `Audit ${marker.slice(-6)}` } });
  save();
  post = await prisma.lostPost.create({ data: { userId: user.id, title: marker, description: "synthetic audit post", category: "기타" } });
  save();
  await prisma.comment.create({ data: { lostPostId: post.id, authorUserId: user.id, content: secretText } });

  const visible = await read();
  checks.push({ name: "visible post: comments readable (control)", ok: visible.status === 200 && visible.leaked, ...visible });
  await prisma.lostPost.update({ where: { id: post.id }, data: { tempHiddenAt: new Date() } });
  const hidden = await read();
  checks.push({ name: "temp-hidden post: anonymous comment read refused", ok: hidden.status === 404 && !hidden.leaked, ...hidden });
  await prisma.lostPost.update({ where: { id: post.id }, data: { tempHiddenAt: null, removedAt: new Date() } });
  const removed = await read();
  checks.push({ name: "removed post: anonymous comment read refused", ok: removed.status === 404 && !removed.leaked, ...removed });
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
