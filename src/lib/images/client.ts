import { upload } from "@vercel/blob/client";

import {
  isAllowedImageContentType,
  MAX_IMAGE_SIZE_BYTES,
  type AllowedImageContentType,
} from "./config";
import { buildImagePathname } from "./pathname";
import type { PostType } from "@/lib/posts/schema";

export type ImageValidationError = { code: "type" | "size"; message: string };

// UX-only pre-check -- /api/upload's onBeforeGenerateToken enforces the
// same limits server-side regardless of what this returns.
export function validateImageFile(file: File): ImageValidationError | null {
  if (!isAllowedImageContentType(file.type)) {
    return { code: "type", message: "JPEG, PNG, WebP 형식만 업로드할 수 있습니다." };
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return { code: "size", message: "파일 크기는 10MB를 넘을 수 없습니다." };
  }
  return null;
}

// Uploads directly from the browser to Blob storage (the file never
// passes through our server) using a token vended by /api/upload, then
// returns the resulting URL/pathname for the caller to attach to the
// post via POST /api/posts/[id]/image.
export async function uploadPostImage(
  postType: PostType,
  postId: number,
  file: File,
): Promise<{ url: string; pathname: string }> {
  const pathname = buildImagePathname(postType, postId, file.type as AllowedImageContentType);
  const blob = await upload(pathname, file, {
    access: "public",
    handleUploadUrl: "/api/upload",
  });
  return { url: blob.url, pathname: blob.pathname };
}
