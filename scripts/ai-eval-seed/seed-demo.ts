// 시연 영상용 4개 시나리오 seed (Preview 전용). 기존 데이터를 초기화하고
// 에어팟/지갑/우산/휴대폰 시나리오별 Lost 1 + 정답 Found 1 + Hard Negative 2를
// 실제 서비스 코드(embedPostBestEffort, createSignedUploadUrl, setPostImage,
// embedPostImageBestEffort)로 생성한 뒤, 실제 검색/추천 함수로 결과를 출력한다.
// Run with: npx tsx --env-file=.env.preview.local scripts/ai-eval-seed/seed-demo.ts --confirm-reset
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db/prisma";
import { embedPostBestEffort, embedPostImageBestEffort } from "@/lib/ai/postEmbedding";
import { createSignedUploadUrl } from "@/lib/images/supabaseAdmin";
import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";
import { buildImagePathname } from "@/lib/images/pathname";
import { setPostImage } from "@/lib/images/service";
import { POST_IMAGES_BUCKET } from "@/lib/images/config";
import { findPostRecommendations, invalidateRecommendationCache } from "@/lib/recommendation/service";
import { searchPosts, searchPostsByImage } from "@/lib/posts/aiService";
import { CURRENT_TERMS_VERSION } from "@/lib/auth/terms";

import { DEMOS, NEGATIVES, PAIRS, POSTERS, type Board, type PostSpec } from "./data";
import { renderJpeg } from "./images";

const PREVIEW_REF = "swqvlihgupranzfzjevb";
const PRODUCTION_REF = "tmifqtyxojtuoejxjrng";

const SCENARIOS = [
  { demoId: "DEMO-3", pairId: "P08", negIds: ["N09", "N12"] },
  { demoId: "DEMO-1", pairId: "P01", negIds: ["N01", "N03"] },
  { demoId: "DEMO-6", pairId: "P17", negIds: ["N22", "N23"] },
  { demoId: "DEMO-4", pairId: "P11", negIds: ["N14", "N16"] },
];

function assertPreviewOnly() {
  const db = process.env.DATABASE_URL ?? "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  let keyRef = "";
  try {
    keyRef = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64").toString("utf8")).ref ?? "";
  } catch {
    keyRef = "";
  }
  const ok =
    db.includes(PREVIEW_REF) &&
    url.includes(PREVIEW_REF) &&
    keyRef === PREVIEW_REF &&
    ![db, url, keyRef].some((v) => v.includes(PRODUCTION_REF));
  if (!ok) throw new Error("Refusing to run: DATABASE_URL / Supabase URL / service key are not all the Preview project.");
  if (!process.argv.includes("--confirm-reset")) throw new Error("Refusing to run without --confirm-reset (this wipes the Preview DB).");
}

const TABLES = [
  "User", "LostPost", "FoundPost", "PostImage", "MatchCandidateCache", "ChatRoom", "Message", "ChatRead",
  "MessageReaction", "Report", "ModerationAction", "AdminActionProposal", "AdminActionApproval",
  "AdminActionAuditLog", "SuspensionAppeal", "Notification", "KeywordAlert", "KeywordAlertMatch", "Comment",
  "PostView", "Announcement", "Feedback", "Organization", "OrganizationMember", "OrganizationCreationRequest",
  "OrganizationJoinRequest",
];

async function resetPreview() {
  // TRUNCATE ... CASCADE also empties AppSettings (its FK to User), so the
  // settings row is snapshotted and restored in the same transaction.
  const settings = await prisma.appSettings.findMany();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE;`);
    for (const s of settings) {
      await tx.appSettings.create({ data: { id: s.id, googleTestModeEnabled: s.googleTestModeEnabled } });
    }
  });
  const storage = getSupabaseAdminClient().storage.from(POST_IMAGES_BUCKET);
  for (const board of ["lost", "found"]) {
    const { data: postDirs } = await storage.list(`posts/${board}`, { limit: 1000 });
    for (const dir of postDirs ?? []) {
      const { data: files } = await storage.list(`posts/${board}/${dir.name}`, { limit: 100 });
      const paths = (files ?? []).map((f) => `posts/${board}/${dir.name}/${f.name}`);
      if (paths.length) await storage.remove(paths);
    }
  }
}

type Created = { key: string; board: Board; id: number; title: string; userId: number };

async function createPost(board: Board, spec: PostSpec, userId: number, now: number, viewCount: number) {
  const createdAt = new Date(now - spec.createdAgoH * 3600_000);
  const eventAt = spec.eventGapH === null ? null : new Date(createdAt.getTime() - spec.eventGapH * 3600_000);
  const base = {
    userId,
    title: spec.title,
    description: spec.description,
    category: spec.category,
    campus: spec.campus,
    location: spec.location,
    createdAt,
    viewCount,
  };
  const row =
    board === "lost"
      ? await prisma.lostPost.create({ data: { ...base, lostAt: eventAt } })
      : await prisma.foundPost.create({ data: { ...base, foundAt: eventAt } });
  await embedPostBestEffort(board, row.id, row);
  if (spec.image) {
    const jpg = await renderJpeg(spec.image);
    const { path: uploadPath, token } = await createSignedUploadUrl(buildImagePathname(board, row.id, "image/jpeg"));
    const { error } = await getSupabaseAdminClient()
      .storage.from(POST_IMAGES_BUCKET)
      .uploadToSignedUrl(uploadPath, token, jpg, { contentType: "image/jpeg" });
    if (error) throw new Error(`upload failed: ${error.message}`);
    const result = await setPostImage(board, row.id, userId, { path: uploadPath });
    if (result.kind !== "ok") throw new Error(`setPostImage failed: ${result.kind}`);
    await embedPostImageBestEffort(board, row.id, result.data.imageUrl);
    await invalidateRecommendationCache(board, row.id);
  }
  return row;
}

async function main() {
  assertPreviewOnly();
  console.log("Target: Preview", PREVIEW_REF);
  await resetPreview();
  console.log("Reset done (AppSettings preserved).");

  const now = Date.now();
  const users = [];
  for (let i = 0; i < 8; i++) {
    users.push(
      await prisma.user.create({
        data: {
          email: `lf.seed.${String(i + 1).padStart(2, "0")}@mju.ac.kr`,
          name: POSTERS[i].nickname,
          nickname: POSTERS[i].nickname,
          privacyConsentAt: new Date(now),
          termsAcceptedAt: new Date(now),
          termsVersion: CURRENT_TERMS_VERSION,
          createdAt: new Date(now - 25 * 24 * 3600_000),
        },
      }),
    );
  }

  // Oldest first so ids ascend with createdAt.
  const jobs: { key: string; board: Board; spec: PostSpec }[] = [];
  for (const s of SCENARIOS) {
    const pair = PAIRS.find((p) => p.pairId === s.pairId)!;
    jobs.push({ key: `${s.pairId}-lost`, board: "lost", spec: pair.lost });
    jobs.push({ key: `${s.pairId}-found`, board: "found", spec: pair.found });
    for (const negId of s.negIds) {
      const neg = NEGATIVES.find((n) => n.negId === negId)!;
      jobs.push({ key: negId, board: neg.board, spec: neg.post });
    }
  }
  jobs.sort((a, b) => b.spec.createdAgoH - a.spec.createdAgoH);

  const created: Created[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const user = users[i % users.length];
    const row = await createPost(job.board, job.spec, user.id, now, 8 + ((i * 37) % 45));
    created.push({ key: job.key, board: job.board, id: row.id, title: row.title, userId: user.id });
    console.log(`  ${job.board} #${row.id} ${job.key} "${row.title}"${job.spec.image ? " [image]" : ""}`);
  }

  const [noText, noImage] = await Promise.all([
    prisma.$queryRaw<{ n: bigint }[]>`SELECT (SELECT count(*) FROM "LostPost" WHERE embedding IS NULL) + (SELECT count(*) FROM "FoundPost" WHERE embedding IS NULL) AS n`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT (SELECT count(*) FROM "LostPost" WHERE image_url IS NOT NULL AND "imageEmbedding" IS NULL) + (SELECT count(*) FROM "FoundPost" WHERE image_url IS NOT NULL AND "imageEmbedding" IS NULL) AS n`,
  ]);
  console.log(`Missing text embeddings: ${noText[0].n}, missing image embeddings: ${noImage[0].n}`);

  // Demo query images (an unseen third view of each lost item) for the
  // image-search part of the video.
  const outDir = path.join(process.cwd(), "docs", "ai-eval-seed", "query-images");
  await mkdir(outDir, { recursive: true });

  const idOf = (key: string) => created.find((c) => c.key === key)!;
  console.log("\n===== RESULTS (real search/recommendation code) =====");
  for (const s of SCENARIOS) {
    const demo = DEMOS.find((d) => d.demoId === s.demoId)!;
    const lost = idOf(`${s.pairId}-lost`);
    const found = idOf(`${s.pairId}-found`);
    console.log(`\n## ${demo.name}  lost #${lost.id} -> answer found #${found.id}`);

    const recs = await findPostRecommendations("lost", lost.id);
    console.log(`  추천(lost #${lost.id} 상세): ${recs.map((r) => `#${r.id}(${(r.score ?? 0).toFixed(3)})`).join(", ") || "-"}`);

    const sem = await searchPosts({ type: "found", mode: "semantic", q: demo.searchQuery, page: 1, limit: 10 });
    console.log(`  의미검색 "${demo.searchQuery}": ${sem.items.map((r) => `#${r.id}(${(r.score ?? 0).toFixed(3)})`).join(", ") || "-"}`);

    const jpg = await renderJpeg(demo.queryImage);
    const file = path.join(outDir, `${s.demoId}.jpg`);
    await writeFile(file, jpg);
    const img = await searchPostsByImage("found", new Blob([new Uint8Array(jpg)], { type: "image/jpeg" }), { page: 1, limit: 10 });
    console.log(`  이미지검색(${path.basename(file)}): ${img.items.map((r) => `#${r.id}(${(r.score ?? 0).toFixed(3)})`).join(", ") || "-"}`);
  }

  console.log("\nPOSTS:");
  for (const c of created) console.log(`  ${c.key}\t${c.board}\t#${c.id}\t${c.title}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
