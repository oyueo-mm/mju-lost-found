import { NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { jsonError, jsonOk, withErrorHandling } from "@/lib/posts/http";
import { getFoundPost, getLostPost } from "@/lib/posts/service";
import { isAllowedImageContentType } from "@/lib/images/config";
import { buildImagePathname } from "@/lib/images/pathname";
import { createSignedUploadUrl } from "@/lib/images/supabaseAdmin";
import { postTypeSchema } from "@/lib/posts/schema";

const requestSchema = z.object({
  postType: postTypeSchema,
  postId: z.number().int().positive(),
  contentType: z.string(),
});

// Mints a short-lived, path-scoped signed upload URL/token for Supabase
// Storage -- the file's bytes never pass through this server (Vercel's
// Serverless Function body-size limit is well under this app's 10MB image
// cap, so proxying the upload through this route isn't viable). This is
// the one and only place login/nickname/suspension/ownership/pathname are
// checked for an upload -- mirrors the legacy design's
// onBeforeGenerateToken() exactly, just against a different storage
// backend (see src/lib/images/supabaseAdmin.ts).
export const POST = withErrorHandling(async (request: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "로그인이 필요합니다.");
  if (user.nickname === null) return jsonError(403, "닉네임을 먼저 설정해주세요.");
  if (isCurrentlySuspended(user)) {
    return jsonError(403, "정지된 계정은 이 기능을 사용할 수 없습니다.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "잘못된 요청 본문입니다.");
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
  }
  const { postType, postId, contentType } = parsed.data;

  if (!isAllowedImageContentType(contentType)) {
    return jsonError(400, "JPEG, PNG, WebP 형식만 업로드할 수 있습니다.");
  }

  const post = postType === "lost" ? await getLostPost(postId) : await getFoundPost(postId);
  if (!post || post.author.id !== user.id) {
    return jsonError(403, "본인 게시물에만 이미지를 업로드할 수 있습니다.");
  }

  const pathname = buildImagePathname(postType, postId, contentType);

  try {
    const { path, token } = await createSignedUploadUrl(pathname);
    return jsonOk({ path, token });
  } catch (error) {
    console.error("Failed to create signed upload URL:", error);
    return jsonError(502, "업로드 준비 중 오류가 발생했습니다.");
  }
});
