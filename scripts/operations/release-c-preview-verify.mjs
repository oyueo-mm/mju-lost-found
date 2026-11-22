import "../db/install-guard.mjs";
import { createJiti } from "jiti";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { resolve } from "node:path";
import fs from "node:fs";
import { assertDatabaseEnvironment, assertScriptSupabaseAccess } from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";

if (assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview") throw new Error("Preview only");
assertScriptSupabaseAccess(process.env);
const f = JSON.parse(fs.readFileSync(".vercel/release-c-review-fixture.json", "utf8"));
if (f.label !== "release-c-codex-review-20261115" || f.roomId !== 156 || f.messageId !== 457 || f.reportId !== 76) throw new Error("Unexpected fixture IDs");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve("src") } });
const { prisma } = await jiti.import(resolve("src/lib/db/prisma.ts"));
const { captureTarget, preserveEvidenceImages } = await jiti.import(resolve("src/lib/report/snapshot.ts"));
const { signEvidenceUrl } = await jiti.import(resolve("src/lib/report/evidenceStorage.ts"));
const db = new Client(pgConfig(process.env.DIRECT_URL));
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const assert = (ok, name) => { if (!ok) throw new Error(name); };
try {
  await db.connect();
  const report = await prisma.report.findUniqueOrThrow({ where: { id: f.reportId } });
  assert(report.detail === f.label && report.targetId === f.messageId && report.reporterUserId === 2, "Fixture report changed");
  const room = await prisma.chatRoom.findUniqueOrThrow({ where: { id: f.roomId } });
  assert(room.postTitle === f.label && room.initiatorUserId === 2 && room.counterpartUserId === 1, "Fixture room changed");
  const evidencePath = report.targetSnapshot.images[0].path;
  const evidence = await sb.storage.from("report-evidence").download(evidencePath);
  assert(!evidence.error, "Fixture evidence missing");
  const bytes = Buffer.from(await evidence.data.arrayBuffer());
  const upload = await sb.storage.from("chat-images").upload(f.imagePath, bytes, { contentType: "image/png", upsert: false, cacheControl: "0" });
  assert(!upload.error, "Fixture source upload failed");
  await prisma.message.update({ where: { id: f.messageId }, data: { content: report.targetSnapshot.target.content, imagePath: f.imagePath } });
  let blocked = false;
  await prisma.$transaction(async (tx) => {
    const captured = await captureTarget(tx, "message", f.messageId);
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout='200ms'");
    try { await db.query(`UPDATE "Message" SET image_url=NULL WHERE id=$1`, [f.messageId]); }
    catch (e) { if (e.code === "55P03") blocked = true; else throw e; }
    finally { await db.query("ROLLBACK"); }
    assert(blocked, "Concurrent source deletion was not blocked");
    const snapshot = await preserveEvidenceImages(f.reportId, captured, tx);
    assert(snapshot.images[0].status === "copied", "Copy under lock failed");
  }, { timeout: 25000 });
  // The writer now succeeds after the capture transaction has released locks.
  await prisma.message.update({ where: { id: f.messageId }, data: { content: `${f.label}: 수정된 현재 본문`, imagePath: null, editedAt: new Date() } });
  assert(!(await sb.storage.from("chat-images").remove([f.imagePath])).error, "Source removal failed");
  assert((await sb.storage.from("report-evidence").exists(evidencePath)).data, "Evidence lost");
  const url = await signEvidenceUrl(evidencePath);
  assert(url, "Evidence signing failed");
  const token = new URL(url).searchParams.get("token");
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  const ttl = payload.exp - Math.floor(Date.now()/1000);
  assert(ttl > 290 && ttl <= 300, "Unexpected signed URL lifetime");
  const signed = await fetch(url);
  assert(signed.ok && Buffer.compare(Buffer.from(await signed.arrayBuffer()), bytes)===0, "Signed image mismatch");
  const anonymous = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/report-evidence/${evidencePath}`);
  assert(!anonymous.ok, "Private evidence publicly readable");
  const policies = (await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND cmd IN ('ALL','SELECT') AND roles && ARRAY['public','anon','authenticated']::name[]`)).rows[0].n;
  console.log(JSON.stringify({ fixtureReport:f.reportId, concurrentDeleteBlocked:blocked, deleteSucceededAfterCommit:true, evidencePreserved:true, signedUrlTtlSeconds:ttl, signedBytesMatch:true, anonymousPublicStatus:anonymous.status, storageReadPoliciesForClients:policies }));
} catch (e) { console.error("Preview verification failed", e.code ?? e.name); process.exitCode=1; }
finally { await db.query("ROLLBACK").catch(() => {}); await db.end(); await prisma.$disconnect(); }
