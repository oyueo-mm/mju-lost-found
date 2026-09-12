// 브라우저에서 업로드 전 이미지 축소. 서버·스토리지·목록 로딩 부담을 줄인다.
// - 긴 변 maxEdge 이하로 줄이고 JPEG(투명 PNG 는 PNG 유지)로 재인코딩
// - EXIF 회전은 createImageBitmap 의 imageOrientation 으로 반영
// - 재인코딩은 항상 수행 → EXIF(GPS·촬영시각·기기) 가 제거된다 (개인정보)
// - 브라우저가 지원 안 하거나 실패하면 원본을 돌려준다 (업로드 자체는 막지 않음)

const DEFAULTS = { maxEdge: 1600, quality: 0.85 };

export async function resizeImage(file, opts = {}) {
  const { maxEdge, quality } = { ...DEFAULTS, ...opts };
  if (!file || !file.type?.startsWith("image/")) return file;
  if (typeof createImageBitmap !== "function") return file;

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = bitmap;
    const scale = Math.min(1, maxEdge / Math.max(width, height));

    // 작은 파일도 건너뛰지 않는다 — 캔버스 재인코딩이 EXIF(GPS·촬영시각)를 지우는
    // 유일한 경로라서, 원본을 그대로 올리면 위치 정보가 공개 URL 로 나간다.

    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const keepPng = file.type === "image/png" && (await hasAlpha(ctx, w, h));
    const type = keepPng ? "image/png" : "image/jpeg";
    const blob = await toBlob(canvas, type, quality);
    if (!blob) return file;

    // 재인코딩 결과가 원본보다 커져도(작은 PNG 등) 그대로 쓴다 — 메타데이터 제거가 우선.

    const base = (file.name || "image").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.${keepPng ? "png" : "jpg"}`, {
      type,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

export async function resizeImages(files, opts) {
  return Promise.all(Array.from(files || []).map((f) => resizeImage(f, opts)));
}

function toBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// 모서리·중앙 몇 픽셀만 샘플링해 투명 여부 판단 (전체 스캔은 큰 이미지에서 느림)
async function hasAlpha(ctx, w, h) {
  const points = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
    [w >> 1, h >> 1],
  ];
  for (const [x, y] of points) {
    const a = ctx.getImageData(x, y, 1, 1).data[3];
    if (a < 255) return true;
  }
  return false;
}
