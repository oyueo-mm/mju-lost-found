// 기존 Storage 이미지 WebP 정식 migration script (maintenance, not part
// of the deployed app). 로컬에서 `.env`를 읽어 node로 직접 실행한다 --
// 서버 전용 SUPABASE_SERVICE_ROLE_KEY를 쓰므로 절대 브라우저 코드/commit
// 대상이 아니다 (이 파일 자체는 커밋해도 되지만 .env 값은 어디에도
// 하드코딩하지 않는다).
//
// 사용법:
//   node scripts/optimizeStorageImages.mjs --dry-run   (기본값, 아무것도 바꾸지 않음)
//   node scripts/optimizeStorageImages.mjs --apply      (실제 변환/교체/DB 갱신 실행)
//
// 무엇을 하는가 (Existing Storage Images WebP Migration Phase):
//   기존 .jpg/.jpeg/.png 이미지를 "같은 디렉터리, 같은 uuid, 확장자만
//   .webp로 바뀐 새 path"로 정식 이전한다. path가 바뀌므로 이를 참조하는
//   모든 DB의 image_url 컬럼(LostPost/FoundPost/PostImage/Message)도
//   새 URL로 갱신한다 -- "같은 path에 바이트만 덮어쓰기"가 아니다.
//
//   이미 .webp인 파일은 애초에 옮길 path가 없으므로(확장자가 이미
//   같음) 별도로 "같은 path에서 한 번 더 최적화"만 제자리 교체
//   (temp-path swap) 방식으로 처리한다 -- 이 경우는 path/URL이 원래도
//   바뀌지 않으므로 DB도 건드릴 필요가 없다.
//
// 안전한 순서 (확장자가 바뀌는 파일 -- 진짜 "migration" 대상):
//   1. 기존 Storage 파일 다운로드
//   2. sharp로 decode
//   3. .rotate()로 EXIF orientation 반영
//   4. 긴 변 최대 1920px로 리사이즈(업스케일 금지)
//   5. WebP quality 82로 재인코딩
//   6. 결과가 원본보다 충분히 작은지 검증(작지 않으면 전체를 건너뜀 --
//      원본 유지, path도 DB도 손대지 않음)
//   7. 새 .webp path에 업로드(해당 path가 이미 존재하면 -- 이론상
//      uuid가 겹칠 수 없어 절대 발생하지 않아야 하지만 -- ambiguous
//      mapping으로 처리하고 그 파일만 건너뜀)
//   8. 새 URL을 실제로 fetch해서 HTTP 200 + Content-Type: image/webp +
//      바이트 완전 일치 확인
//   9. 이 old URL을 참조하는 모든 DB 행(여러 테이블에 걸쳐 있을 수
//      있음)을 하나의 트랜잭션으로 함께 새 URL로 UPDATE(각 UPDATE는
//      `WHERE image_url = 기존 url`로 가드 -- 스캔 이후 값이 이미
//      바뀐 행이 있으면 영향받은 행 수가 예상과 달라지고, 그 경우 전체
//      트랜잭션을 롤백한다)
//  10. 커밋 후 다시 SELECT해서 실제로 새 URL로 저장됐는지 재확인
//  11. 모든 DB 참조가 새 URL을 가리키는 것을 확인한 "이후에만" 기존
//      파일을 삭제한다. 기존 파일 삭제 실패는 orphan 후보로 명확히
//      로그에 남기되(조용히 무시하지 않음), migration 자체는 이미
//      Storage+DB가 일관된 상태이므로 실패로 집계하지 않는다.
//
// DB 업데이트 실패 시: 새 webp 객체는 남아있지만(다음 실행에서 재사용
// 시도되지는 않음 -- old url이 여전히 old path를 가리키므로 다음 실행은
// 같은 old path를 다시 후보로 본다) 기존 원본은 그대로 보존되고, old
// path는 여전히 DB가 가리키는 유효한 참조로 남는다 -- 기능적으로 전혀
// 깨지지 않는다. 실패한 신규 webp 객체는 정리(삭제)를 시도한다.
//
// --apply 실행 시에도 실제 쓰기 작업 전에 먼저 전체 dry-run과 동일한
// 계산을 한 번 수행해서 decode 실패/업로드 검증 실패/DB 참조 불일치/
// path 충돌이 하나라도 있으면 그 시점에 전체 실행을 중단한다(아무것도
// 쓰지 않은 채로) -- "오류나 참조 불일치가 있으면 멈춘다"는 요구사항의
// 실제 구현.

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

for (const line of readFileSync("C:/proj_claude/mju-lost-found-vercel/.env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^"(.*)"$/, "$1");
}

const BUCKET = "post-images";
const MAX_DIMENSION = 1920;
const WEBP_QUALITY = 82;
// 원본이 이 크기보다 작으면 굳이 재인코딩해도 절감이 미미할 가능성이
// 높지만, "충분히 작아진 경우에만 교체"라는 원칙은 실제 인코딩 결과
// (MIN_SAVING_RATIO)로 최종 판단한다 -- 이 값은 아주 작은 파일까지
// 굳이 왕복시키지 않기 위한 얕은 사전 필터일 뿐이다.
const SKIP_IF_SMALLER_THAN_BYTES = 20 * 1024; // 20KB
// 변환 후 크기가 원본의 이 비율보다 크면(= 절감이 미미하면) 교체하지
// 않는다.
const MIN_SAVING_RATIO = 0.95; // optimized/original < 0.95 여야 교체

// image_url을 저장하는 스키마상의 모든 컬럼 -- prisma/schema.prisma에서
// `@map("image_url")`로 검색해 재확인한 정확히 이 4개뿐이다(다른 모델
// 없음). 순서는 조회/갱신 로그 표시용일 뿐, 의미는 없다.
const TABLES = [
  { name: "PostImage", idCol: "id" },
  { name: "LostPost", idCol: "id" },
  { name: "FoundPost", idCol: "id" },
  { name: "Message", idCol: "id" },
];

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function publicUrlFor(path) {
  return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
function pathFromPublicUrl(url) {
  const prefix = publicUrlFor("");
  if (!url.startsWith(prefix)) return null;
  return decodeURIComponent(url.slice(prefix.length));
}
function categoryOf(path) {
  return path.startsWith("chat/") ? "chat" : "post";
}
// posts/found/36/abc.jpg -> posts/found/36/abc.webp (uuid 그대로, 확장자만 교체)
function webpPathFor(path) {
  return path.replace(/\.[A-Za-z0-9]+$/, ".webp");
}

// 하나의 pg 연결을 스크립트 전체에서 재사용 -- dry-run 스캔, apply의
// 사전 검사, 실제 UPDATE 트랜잭션 모두 같은 연결을 쓴다(간단한 21개
// 파일 규모의 maintenance script이므로 커넥션 풀은 불필요).
const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();

// old image_url 문자열 -> 그 값을 갖는 모든 (table, id) 참조 목록.
// 하나의 실제 파일(=하나의 URL)을 PostImage.imageUrl과
// LostPost.imageUrl이 동시에 가리키는 경우가 실제로 있으므로(주 이미지
// 캐시), 이 맵이 "몇 개의 DB 행을 함께 갱신해야 하는가"의 근거가 된다.
async function collectReferencesByUrl() {
  const byUrl = new Map();
  for (const { name, idCol } of TABLES) {
    const { rows } = await db.query(`SELECT ${idCol} AS id, image_url FROM "${name}" WHERE image_url IS NOT NULL`);
    for (const row of rows) {
      const list = byUrl.get(row.image_url) ?? [];
      list.push({ table: name, idCol, id: row.id });
      byUrl.set(row.image_url, list);
    }
  }
  return byUrl;
}

async function downloadObject(path) {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`download failed: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}

async function optimize(buffer) {
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) throw new Error("could not read image dimensions");
  const scale = Math.min(1, MAX_DIMENSION / Math.max(meta.width, meta.height));
  const width = Math.max(1, Math.round(meta.width * scale));
  const height = Math.max(1, Math.round(meta.height * scale));
  const optimized = await sharp(buffer)
    .rotate() // apply EXIF orientation, matching client.ts's { imageOrientation: "from-image" }
    .resize({ width, height, fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
  return { optimized, meta, width, height };
}

async function uploadAndVerify(path, buffer, { upsert }) {
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: "image/webp", upsert });
  if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);

  const res = await fetch(publicUrlFor(path), { cache: "no-store" });
  if (!res.ok) throw new Error(`verify fetch failed: HTTP ${res.status}`);
  const contentType = res.headers.get("content-type");
  if (contentType !== "image/webp") throw new Error(`verify fetch: unexpected content-type "${contentType}"`);
  const fetched = Buffer.from(await res.arrayBuffer());
  if (!fetched.equals(buffer)) throw new Error("verify fetch: byte mismatch after upload");
}

async function objectExists(path) {
  const dir = path.split("/").slice(0, -1).join("/");
  const name = path.split("/").pop();
  const { data, error } = await admin.storage.from(BUCKET).list(dir, { search: name });
  if (error) return false;
  return (data ?? []).some((f) => f.name === name);
}

// Phase 요구사항: 확장자가 바뀌는(진짜 migration) 파일 하나를 안전하게
// 처리한다 -- 새 path 업로드 -> 검증 -> DB 참조 전체를 한 트랜잭션으로
// 갱신 -> 재검증 -> 그 이후에만 원본 삭제.
async function migrateRenamed(target, refs, stats, log) {
  const { path: oldPath, url: oldUrl, category, optimized } = target;
  const newPath = webpPathFor(oldPath);
  const newUrl = publicUrlFor(newPath);

  if (await objectExists(newPath)) {
    log(`[FAIL ambiguous-mapping] ${category} ${oldPath} -> ${newPath} already exists (unexpected uuid collision) -- skipped, original untouched`);
    stats.ambiguousMapping++;
    stats.finalBytes += target.originalBytes;
    return;
  }

  try {
    await uploadAndVerify(newPath, optimized, { upsert: false });
  } catch (error) {
    log(`[FAIL verify-new-path] ${category} ${oldPath} -> ${newPath}: ${error.message} (original untouched)`);
    stats.verifyFailed++;
    stats.finalBytes += target.originalBytes;
    await admin.storage.from(BUCKET).remove([newPath]).catch(() => {});
    return;
  }

  // 이 old URL을 참조하는 모든 행을 하나의 트랜잭션으로 갱신. 각 UPDATE는
  // WHERE image_url = oldUrl로 가드하므로, 스캔 이후 실제로 값이 바뀐
  // 행이 있으면 rowCount가 기대와 달라 전체를 롤백한다(unresolved
  // reference).
  await db.query("BEGIN");
  try {
    for (const ref of refs) {
      const result = await db.query(
        `UPDATE "${ref.table}" SET image_url = $1 WHERE ${ref.idCol} = $2 AND image_url = $3`,
        [newUrl, ref.id, oldUrl],
      );
      if (result.rowCount !== 1) {
        throw new Error(`unresolved reference: ${ref.table}#${ref.id} no longer has the expected image_url`);
      }
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    log(`[FAIL db-update] ${category} ${oldPath}: ${error.message} (new webp cleaned up, original untouched)`);
    stats.dbUpdateFailed++;
    stats.finalBytes += target.originalBytes;
    await admin.storage.from(BUCKET).remove([newPath]).catch(() => {});
    return;
  }

  // 재확인: 커밋된 값이 실제로 새 URL을 가리키는지 다시 읽어서 검증.
  let verifiedAll = true;
  for (const ref of refs) {
    const { rows } = await db.query(`SELECT image_url FROM "${ref.table}" WHERE ${ref.idCol} = $1`, [ref.id]);
    if (rows[0]?.image_url !== newUrl) verifiedAll = false;
  }
  if (!verifiedAll) {
    log(`[WARN db-verify-mismatch] ${category} ${oldPath}: DB commit succeeded but re-read didn't match -- investigate manually. New file and DB URL are still the new webp; original NOT deleted.`);
    stats.dbUpdateFailed++;
    stats.finalBytes += target.optimizedBytes;
    return; // 원본을 지우지 않고 사람이 확인하도록 남겨둔다.
  }

  log(`  [OK] ${category} ${oldPath} -> ${newPath} (DB refs updated: ${refs.length})`);
  stats.dbUpdated += refs.length;

  const { error: removeError } = await admin.storage.from(BUCKET).remove([oldPath]);
  if (removeError) {
    log(`[WARN orphan-old-file] ${category} ${oldPath}: DB/새 파일은 정상이지만 원본 삭제 실패 -- 수동 정리 필요: ${removeError.message}`);
    stats.orphanOldFiles++;
  } else {
    stats.oldFilesDeleted++;
  }

  stats.migrated++;
  stats.finalBytes += target.optimizedBytes;
}

// 이미 .webp인 파일: path/URL이 원래도 바뀌지 않으므로 DB는 손대지
// 않는다. 이전 Phase와 동일한 temp-path 안전 교체만 수행.
async function reoptimizeInPlace(target, stats, log) {
  const { path, category, optimized } = target;
  const tempPath = `${path}.optimize-tmp-${Date.now()}`;
  try {
    await uploadAndVerify(tempPath, optimized, { upsert: true });
  } catch (error) {
    log(`[FAIL verify-temp] ${category} ${path}: ${error.message} (original untouched)`);
    stats.verifyFailed++;
    stats.finalBytes += target.originalBytes;
    await admin.storage.from(BUCKET).remove([tempPath]).catch(() => {});
    return;
  }
  try {
    await uploadAndVerify(path, optimized, { upsert: true });
  } catch (error) {
    log(`[FAIL verify-final] ${category} ${path}: ${error.message} (original untouched)`);
    stats.verifyFailed++;
    stats.finalBytes += target.originalBytes;
    await admin.storage.from(BUCKET).remove([tempPath]).catch(() => {});
    return;
  }
  await admin.storage.from(BUCKET).remove([tempPath]).catch((e) => log(`  temp cleanup warning: ${e}`));
  log(`  [OK] ${category} ${path} re-optimized in place (already .webp, URL unchanged, no DB update needed)`);
  stats.reoptimizedInPlace++;
  stats.finalBytes += target.optimizedBytes;
}

// dry-run과 apply의 사전 검사가 완전히 같은 코드로 후보 목록/통계를
// 계산하도록 공유한다 -- apply가 "먼저 dry-run과 동일한 계산을 해서
// 문제가 있으면 멈춘다"를 보장하는 핵심.
async function scanCandidates(byUrl) {
  const targets = [];
  const stats = {
    totalFiles: 0,
    alreadyWebpCandidates: 0,
    renameCandidates: 0,
    skippedTooSmall: 0,
    skippedNoGain: 0,
    convertFailed: 0,
    downloadFailed: 0,
    originalBytes: 0,
  };

  const seenUrls = new Set();
  for (const [url, refs] of byUrl) {
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    const path = pathFromPublicUrl(url);
    if (!path) {
      console.warn(`  [skip] URL이 이 버킷의 것이 아님: ${url}`);
      continue;
    }
    stats.totalFiles++;
    const category = categoryOf(path);

    let original;
    try {
      original = await downloadObject(path);
    } catch (error) {
      console.log(`[FAIL download] ${category} ${path}: ${error.message}`);
      stats.downloadFailed++;
      continue;
    }
    stats.originalBytes += original.length;

    if (original.length < SKIP_IF_SMALLER_THAN_BYTES) {
      console.log(`[SKIP too-small] ${category} ${path} (${original.length}B)`);
      stats.skippedTooSmall++;
      continue;
    }

    let optResult;
    try {
      optResult = await optimize(original);
    } catch (error) {
      console.log(`[FAIL convert] ${category} ${path}: ${error.message}`);
      stats.convertFailed++;
      continue;
    }
    const { optimized, meta, width, height } = optResult;

    if (optimized.length >= original.length * MIN_SAVING_RATIO) {
      console.log(
        `[SKIP no-gain] ${category} ${path} (${meta.format} ${meta.width}x${meta.height} ${original.length}B -> webp ${width}x${height} ${optimized.length}B, not enough saving)`,
      );
      stats.skippedNoGain++;
      continue;
    }

    const isAlreadyWebp = /\.webp$/i.test(path);
    if (isAlreadyWebp) stats.alreadyWebpCandidates++;
    else stats.renameCandidates++;

    const reduction = (1 - optimized.length / original.length) * 100;
    console.log(
      `[CANDIDATE ${isAlreadyWebp ? "re-optimize-in-place" : "migrate .webp"}] ${category} ${path}${isAlreadyWebp ? "" : ` -> ${webpPathFor(path)}`}: ${meta.format} ${meta.width}x${meta.height} ${original.length}B -> webp ${width}x${height} ${optimized.length}B (-${reduction.toFixed(1)}%) [DB refs: ${refs.length}]`,
    );

    targets.push({
      url,
      path,
      category,
      refs,
      isAlreadyWebp,
      optimized,
      originalBytes: original.length,
      optimizedBytes: optimized.length,
    });
  }

  return { targets, stats };
}

// path 충돌(서로 다른 old path가 같은 new .webp path로 매핑되는 경우) --
// uuid가 유지되므로 이론상 발생할 수 없지만, apply 전 명시적으로
// 검사한다.
function findAmbiguousMappings(targets) {
  const byNewPath = new Map();
  for (const t of targets) {
    if (t.isAlreadyWebp) continue;
    const newPath = webpPathFor(t.path);
    const list = byNewPath.get(newPath) ?? [];
    list.push(t.path);
    byNewPath.set(newPath, list);
  }
  return [...byNewPath.entries()].filter(([, paths]) => paths.length > 1);
}

function printSummary(label, stats, targetsCount) {
  const savedBytes = stats.originalBytes - stats.finalBytes;
  const savedRatio = stats.originalBytes > 0 ? (savedBytes / stats.originalBytes) * 100 : 0;
  console.log(`\n========== ${label} ==========`);
  console.log(`total files: ${stats.totalFiles}`);
  console.log(`candidate files: ${targetsCount}`);
  console.log(`already webp (re-optimize in place): ${stats.alreadyWebpCandidates}`);
  console.log(`rename to .webp (migration): ${stats.renameCandidates}`);
  console.log(`skipped (already small): ${stats.skippedTooSmall}`);
  console.log(`skipped (no meaningful gain): ${stats.skippedNoGain}`);
  console.log(`failed (convert): ${stats.convertFailed}`);
  console.log(`failed (download): ${stats.downloadFailed}`);
  console.log(`old total size: ${(stats.originalBytes / 1024).toFixed(1)} KB`);
  console.log(`new total size: ${(stats.finalBytes / 1024).toFixed(1)} KB`);
  console.log(`estimated savings: ${(savedBytes / 1024).toFixed(1)} KB`);
  console.log(`estimated savings %: ${savedRatio.toFixed(1)}%`);
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (no Storage writes, no DB writes)" : "APPLY (will migrate paths + update DB)"}\n`);

  const byUrl = await collectReferencesByUrl();
  console.log(`고유 image_url 개수: ${byUrl.size}`);
  const multiRef = [...byUrl.entries()].filter(([, refs]) => refs.length > 1);
  if (multiRef.length > 0) {
    console.log(`여러 DB 행이 같은 URL을 공유하는 경우: ${multiRef.length}건`);
    for (const [url, refs] of multiRef.slice(0, 5)) {
      console.log(`  ${url}\n    referenced by: ${refs.map((r) => `${r.table}#${r.id}`).join(", ")}`);
    }
  }

  const { targets, stats } = await scanCandidates(byUrl);
  const ambiguous = findAmbiguousMappings(targets);

  // finalBytes를 dry-run 표시용으로 별도 채운다 (scanCandidates는 실제
  // 적용 여부와 무관하게 후보만 모으므로, 여기서 "적용됐다면 이랬을
  // 것"이라는 합계를 만든다). skip/실패로 빠진 파일의 바이트는
  // originalBytes에 이미 포함돼 있지 않으므로 합산하지 않는다 -- 이
  // summary는 오직 "실제 후보가 된 파일들"의 절감 예상치다.
  stats.finalBytes = targets.reduce((sum, t) => sum + t.optimizedBytes, 0);
  stats.originalBytes = targets.reduce((sum, t) => sum + t.originalBytes, 0);

  console.log("\n예시 mapping:");
  for (const t of targets.filter((t) => !t.isAlreadyWebp).slice(0, 3)) {
    console.log(`OLD:\n  ${t.path}\nNEW:\n  ${webpPathFor(t.path)}\nDB references:\n  ${t.refs.length}\n`);
  }

  printSummary(DRY_RUN ? "DRY-RUN 결과" : "APPLY 전 사전 검사(dry-run과 동일 계산)", stats, targets.length);

  const unresolvedCount = 0; // scanCandidates 시점엔 아직 UPDATE를 시도하지 않았으므로 항상 0 -- 실제 unresolved는 apply 도중에만 발생 가능하며, 그 경우 해당 파일만 개별적으로 실패 처리된다(중단 조건에는 사전 검사 단계의 값만 사용).
  const shouldAbort = stats.convertFailed > 0 || stats.downloadFailed > 0 || ambiguous.length > 0;

  if (ambiguous.length > 0) {
    console.log("\n[ABORT 조건] ambiguous path mapping 발견:");
    for (const [newPath, oldPaths] of ambiguous) {
      console.log(`  ${newPath} <- ${oldPaths.join(", ")}`);
    }
  }

  if (DRY_RUN) {
    console.log("\nDry-run만 실행됨 -- Storage/DB 모두 전혀 변경되지 않았다. 실제 적용하려면 --apply로 다시 실행할 것.");
    await db.end();
    return;
  }

  if (shouldAbort) {
    console.log(
      `\n[ABORT] decode/download 실패(${stats.convertFailed + stats.downloadFailed}건) 또는 ambiguous mapping(${ambiguous.length}건)이 있어 apply를 중단한다. 어떤 Storage/DB 쓰기도 수행하지 않았다.`,
    );
    await db.end();
    process.exitCode = 1;
    return;
  }

  console.log(`\n사전 검사 통과 (unresolved reference: ${unresolvedCount}, ambiguous mapping: 0) -- 실제 migration을 시작한다.\n`);

  const runStats = {
    migrated: 0,
    reoptimizedInPlace: 0,
    dbUpdated: 0,
    oldFilesDeleted: 0,
    orphanOldFiles: 0,
    verifyFailed: 0,
    dbUpdateFailed: 0,
    ambiguousMapping: 0,
    originalBytes: stats.originalBytes,
    finalBytes: 0,
  };

  for (const target of targets) {
    if (target.isAlreadyWebp) {
      await reoptimizeInPlace(target, runStats, console.log);
    } else {
      await migrateRenamed(target, target.refs, runStats, console.log);
    }
  }

  console.log("\n========== APPLY 결과 ==========");
  console.log(`처리 성공(migrate): ${runStats.migrated}`);
  console.log(`처리 성공(re-optimize in place): ${runStats.reoptimizedInPlace}`);
  console.log(`변경 없음(사전 검사에서 이미 skip): ${stats.skippedTooSmall + stats.skippedNoGain}`);
  console.log(`변환 실패: ${stats.convertFailed}`);
  console.log(`검증 실패: ${runStats.verifyFailed}`);
  console.log(`건너뜀(download 실패): ${stats.downloadFailed}`);
  console.log(`DB update 실패/롤백: ${runStats.dbUpdateFailed}`);
  console.log(`DB row 업데이트 수: ${runStats.dbUpdated}`);
  console.log(`기존 파일 삭제 완료: ${runStats.oldFilesDeleted}`);
  console.log(`기존 파일 삭제 실패(orphan, 수동 정리 필요): ${runStats.orphanOldFiles}`);
  const savedBytes = runStats.originalBytes - runStats.finalBytes;
  console.log(`원본 총 용량: ${(runStats.originalBytes / 1024).toFixed(1)} KB`);
  console.log(`최적화 후 총 용량: ${(runStats.finalBytes / 1024).toFixed(1)} KB`);
  console.log(`실제 절감량: ${(savedBytes / 1024).toFixed(1)} KB`);
  console.log(`실제 절감률: ${((savedBytes / runStats.originalBytes) * 100).toFixed(1)}%`);
  if (runStats.orphanOldFiles > 0) {
    console.log(`\n[주의] ${runStats.orphanOldFiles}개의 기존 파일이 삭제되지 않고 orphan으로 남아 있다 -- 위 로그의 [WARN orphan-old-file] 항목을 참고해 수동으로 정리할 것.`);
  }

  await db.end();
}

await main();
