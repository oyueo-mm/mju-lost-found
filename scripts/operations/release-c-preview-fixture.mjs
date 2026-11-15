import "../db/install-guard.mjs";
import { createJiti } from "jiti";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import fs from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { assertDatabaseEnvironment, assertScriptSupabaseAccess } from "../../src/lib/db/accessPolicy.mjs";

if (assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview") throw new Error("Preview only");
assertScriptSupabaseAccess(process.env);
if (!process.argv.includes("--create")) throw new Error("Requires --create; creates an isolated Preview review fixture only");
const marker = resolve(".vercel/release-c-review-fixture.json");
if (fs.existsSync(marker)) throw new Error("Review fixture already recorded; inspect it before creating another");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve("src") } });
const { prisma } = await jiti.import(resolve("src/lib/db/prisma.ts"));
const { createReport } = await jiti.import(resolve("src/lib/report/service.ts"));
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const fixture = { label: "release-c-codex-review-20261115", roomId: null, messageId: null, reportId: null, imagePath: null };
const save = () => { fs.mkdirSync(resolve(".vercel"), { recursive: true }); fs.writeFileSync(marker, JSON.stringify(fixture, null, 2)); };
try {
  const reporter = await prisma.user.findUniqueOrThrow({ where: { id: 2 } });
  const sender = await prisma.user.findUniqueOrThrow({ where: { id: 1 } });
  if (reporter.withdrawnAt || sender.withdrawnAt || reporter.isSuspended || sender.isSuspended) throw new Error("Fixture actors are not active");
  const room = await prisma.chatRoom.create({ data: { postType: "lost", postTitle: fixture.label, initiatorUserId: 2, counterpartUserId: 1 } });
  fixture.roomId = room.id;
  fixture.imagePath = `chat/${room.id}/${randomUUID()}.png`;
  save();
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  const upload = await sb.storage.from("chat-images").upload(fixture.imagePath, bytes, { contentType: "image/png", upsert: false, cacheControl: "0" });
  if (upload.error) throw new Error("Fixture upload failed");
  const message = await prisma.message.create({ data: { chatRoomId: room.id, senderUserId: 1, content: `${fixture.label}: 신고 당시 본문`, imagePath: fixture.imagePath } });
  fixture.messageId = message.id;
  save();
  const result = await createReport(reporter, { targetType: "message", targetId: message.id, reason: "기타", detail: fixture.label });
  if (result.kind !== "ok") throw new Error("Fixture report failed");
  fixture.reportId = result.data.id;
  save();
  const row = await prisma.report.findUniqueOrThrow({ where: { id: fixture.reportId } });
  const snapshot = row.targetSnapshot;
  if (snapshot?.target?.content !== message.content || snapshot?.images?.[0]?.status !== "copied") throw new Error("Evidence capture failed");
  const evidence = await sb.storage.from("report-evidence").download(snapshot.images[0].path);
  if (evidence.error || createHash("sha256").update(Buffer.from(await evidence.data.arrayBuffer())).digest("hex") !== createHash("sha256").update(bytes).digest("hex")) throw new Error("Evidence bytes mismatch");
  // Mutate only the newly created fixture; its original no longer exists.
  await prisma.message.update({ where: { id: message.id }, data: { content: `${fixture.label}: 수정된 현재 본문`, imagePath: null, editedAt: new Date() } });
  const removed = await sb.storage.from("chat-images").remove([fixture.imagePath]);
  if (removed.error) throw new Error("Fixture original removal failed");
  const preserved = await sb.storage.from("report-evidence").exists(snapshot.images[0].path);
  if (preserved.error || !preserved.data) throw new Error("Evidence did not survive original deletion");
  console.log(JSON.stringify({ ...fixture, imagePath: undefined, snapshotTextPreserved: true, evidenceBytesMatch: true, originalRemoved: true, readyForManualReview: true }));
} catch (e) { console.error("Preview fixture failed; recorded IDs need cleanup", e.code ?? e.name); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
