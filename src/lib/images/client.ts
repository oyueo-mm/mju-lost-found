import {
  isAllowedImageContentType,
  MAX_IMAGE_SIZE_BYTES,
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

// 1) Ask our own server (POST /api/upload) to mint a signed upload
//    credential -- this is where login/suspension/ownership/pathname are
//    actually checked, not here.
// 2) Upload the file directly from the browser to Supabase Storage using
//    that credential (the file never passes through our server).
// 3) Return the storage path for the caller to attach to the post via
//    POST /api/posts/[id]/image, which re-derives and re-validates
//    everything server-side rather than trusting this return value.
export async function uploadPostImage(
  postType: PostType,
  postId: number,
  file: File,
): Promise<{ path: string }> {
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postType, postId, contentType: file.type }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? "업로드 준비 중 오류가 발생했습니다.");
  }
  const { data } = (await res.json()) as { data: { path: string; token: string } };

  await uploadToSignedUrl(data.path, data.token, file);

  return { path: data.path };
}
