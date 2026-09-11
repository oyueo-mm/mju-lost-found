import {
  isAllowedImageContentType,
  MAX_IMAGE_SIZE_BYTES,
  type AllowedImageContentType,
} from "./config";
import { uploadToSignedUrl } from "./supabaseBrowser";
import type { PostType } from "@/lib/posts/schema";

export type ImageValidationError = { code: "type" | "size"; message: string };

// UX-only pre-check -- /api/upload enforces the same limits server-side
// (and the post-images bucket itself is also configured with a matching
// file_size_limit/allowed_mime_types, see the Phase 4 report) regardless
// of what this returns.
export function validateImageFile(file: File): ImageValidationError | null {
  if (!isAllowedImageContentType(file.type)) {
    return { code: "type", message: "JPEG, PNG, WebP 형식만 업로드할 수 있습니다." };
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return { code: "size", message: "파일 크기는 10MB를 넘을 수 없습니다." };
  }
  return null;
}

// 이미지 업로드 최적화 Phase: 게시글 이미지는 여전히 브라우저에서 Supabase
// Storage로 직접 업로드된다(이 파일의 uploadPostImage()가 이미 그렇게
// 되어 있었다 -- 파일 바이트가 이 앱의 서버를 절대 거치지 않는다, see
// /api/upload/route.ts's own comment: Vercel Serverless Function의
// body-size 한도가 이 앱의 10MB 업로드 한도보다 훨씬 작아서 서버를
// 경유하는 구조 자체가 애초에 불가능했다). 그래서 sharp 같은 서버 전용
// 이미지 처리 라이브러리는 이 업로드 경로에 아예 적용할 수 없고, 리사이즈/
// 압축은 브라우저의 Canvas API로만 할 수 있다 -- 이 앱이 이미 광범위하게
// 지원을 가정하는 최신 브라우저 기능(fetch, FormData 등)과 같은 수준으로
// 안정적으로 쓸 수 있다.
//
// 최대 해상도는 긴 변 기준 1920px -- 이미 그보다 작은 사진은 절대
// 업스케일하지 않는다(원본 화질 유지). WebP 품질 0.82는 사진 콘텐츠에서
// 눈에 띄는 화질 저하 없이 용량을 크게 줄이는, 일반적으로 권장되는
// 수준이다. createImageBitmap에 `imageOrientation: "from-image"`를 명시해
// EXIF Orientation 태그를 반영한 뒤 canvas에 그리므로 사진이 옆으로
// 눕거나 뒤집히는 문제가 생기지 않는다 -- 그리고 canvas 재인코딩 자체가
// EXIF/ICC 등 원본 메타데이터를 전혀 들고 오지 않으므로 별도 코드 없이
// 메타데이터가 함께 제거된다.
//
// 이 파이프라인 중 어디서든 실패하면(구형 브라우저, 디코드 실패 등)
// 원본 File을 그대로 업로드한다 -- 최적화가 실패했다고 업로드 자체가
// 실패하지 않는다, 이 phase 이전과 동일한 동작으로 안전하게 되돌아간다.
const MAX_IMAGE_DIMENSION = 1920;
const WEBP_QUALITY = 0.82;

async function optimizeImageForUpload(
  file: File,
): Promise<{ blob: Blob; contentType: AllowedImageContentType }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2D canvas context unavailable");
      ctx.drawImage(bitmap, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY));
      // 일부 구형 브라우저는 요청한 type을 무시하고 PNG로 인코딩한다 --
      // 그래도 리사이즈+메타데이터 제거는 이미 적용된 상태이므로, 실제
      // 결과 타입이 이 앱이 이미 허용하는 형식(webp/png/jpeg)이라면
      // 그대로 사용한다. 그 외의 경우(null 등)에만 원본으로 폴백한다.
      if (blob && isAllowedImageContentType(blob.type)) {
        return { blob, contentType: blob.type };
      }
      throw new Error(`Unsupported canvas.toBlob() result: ${blob?.type ?? "null"}`);
    } finally {
      bitmap.close();
    }
  } catch (error) {
    console.error("Failed to optimize image before upload, falling back to original file:", error);
    return {
      blob: file,
      contentType: isAllowedImageContentType(file.type) ? file.type : "image/jpeg",
    };
  }
}

// 0) 이미지 업로드 최적화 Phase: 원본 File을 리사이즈(긴 변 최대 1920px)
//    + WebP 재인코딩(품질 0.82)한 Blob으로 먼저 변환한다 -- 실패 시
//    원본 File로 안전하게 폴백(optimizeImageForUpload's own comment).
// 1) Ask our own server (POST /api/upload) to mint a signed upload
//    credential -- this is where login/suspension/ownership/pathname are
//    actually checked, not here. contentType은 이제 원본 file.type이
//    아니라 실제로 업로드할 blob의 최종 contentType(최적화됐다면
//    "image/webp"인 경우가 대부분)을 그대로 알려준다 -- pathname의
//    확장자가 실제 업로드되는 바이트와 항상 일치해야 하기 때문이다.
// 2) Upload the (optimized, or original as fallback) blob directly from
//    the browser to Supabase Storage using that credential (the bytes
//    never pass through our server).
// 3) Return the storage path for the caller to attach to the post via
//    POST /api/posts/[id]/image, which re-derives and re-validates
//    everything server-side rather than trusting this return value.
export async function uploadPostImage(
  postType: PostType,
  postId: number,
  file: File,
): Promise<{ path: string }> {
  const { blob, contentType } = await optimizeImageForUpload(file);

  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postType, postId, contentType }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? "업로드 준비 중 오류가 발생했습니다.");
  }
  const { data } = (await res.json()) as { data: { path: string; token: string } };

  await uploadToSignedUrl(data.path, data.token, blob);

  return { path: data.path };
}

// Chat-image counterpart of uploadPostImage() above -- same three-step
// flow (mint a signed credential from our server, upload straight to
// Storage, hand back only the path for the caller to report to POST
// /api/chat/[id]/messages, which re-derives/re-validates the URL itself),
// just against POST /api/chat/[id]/upload instead (that route checks chat
// room membership, not post ownership -- see its own comment).
//
// 이미지 업로드 최적화 Phase (채팅): uploadPostImage()와 똑같은
// optimizeImageForUpload()를 그대로 재사용한다 -- 별도의 채팅 전용
// 최적화 로직을 새로 만들지 않는다. 나머지 흐름(업로드 자격 증명 발급/
// Storage 업로드/path 반환)과 URL/path 구조는 전혀 바뀌지 않는다.
export async function uploadChatImage(chatRoomId: number, file: File): Promise<{ path: string }> {
  const { blob, contentType } = await optimizeImageForUpload(file);

  const res = await fetch(`/api/chat/${chatRoomId}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? "업로드 준비 중 오류가 발생했습니다.");
  }
  const { data } = (await res.json()) as { data: { path: string; token: string } };

  await uploadToSignedUrl(data.path, data.token, blob);

  return { path: data.path };
}
