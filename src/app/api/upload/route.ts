import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { jsonError, withErrorHandling } from "@/lib/posts/http";
import { getFoundPost, getLostPost } from "@/lib/posts/service";
import { ALLOWED_IMAGE_CONTENT_TYPES, MAX_IMAGE_SIZE_BYTES } from "@/lib/images/config";
import { isValidImagePathname, parseImagePathname } from "@/lib/images/pathname";

// Vendor a short-lived, tightly-scoped client upload token instead of
// proxying the file bytes through this server -- the file goes straight
// from the browser to Blob storage. BLOB_READ_WRITE_TOKEN itself never
// leaves the server; only handleUpload() reads it (defaults to
// process.env.BLOB_READ_WRITE_TOKEN).
export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const user = await getCurrentUser();
        if (!user) throw new Error("로그인이 필요합니다.");
        if (user.nickname === null) throw new Error("닉네임을 먼저 설정해주세요.");
        if (isCurrentlySuspended(user)) {
          throw new Error("정지된 계정은 이 기능을 사용할 수 없습니다.");
        }

        // The browser proposes the pathname; it's never trusted as-is --
        // it must match posts/{lost|found}/{postId}/{uuid}.{ext} exactly
        // (see src/lib/images/pathname.ts), and postId must be a post
        // this user actually owns. Both checks together are what stop
        // someone from minting an upload token for another user's post.
        if (!isValidImagePathname(pathname)) {
          throw new Error("잘못된 업로드 경로입니다.");
        }
        const parsed = parseImagePathname(pathname);
        if (!parsed) throw new Error("잘못된 업로드 경로입니다.");

        const post =
          parsed.postType === "lost"
            ? await getLostPost(parsed.postId)
            : await getFoundPost(parsed.postId);
        if (!post || post.author.id !== user.id) {
          throw new Error("본인 게시물에만 이미지를 업로드할 수 있습니다.");
        }

        return {
          allowedContentTypes: [...ALLOWED_IMAGE_CONTENT_TYPES],
          maximumSizeInBytes: MAX_IMAGE_SIZE_BYTES,
          addRandomSuffix: false, // pathname already ends in a uuid
        };
      },
      // onUploadCompleted is intentionally omitted: Vercel calls it back
      // over the public internet, which a local/undeployed dev server
      // can't receive. Attaching the finished upload's URL to the post is
      // instead done by an explicit client call to
      // /api/posts/[id]/image (see src/lib/images/service.ts), which
      // re-validates the URL server-side rather than trusting the client.
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return jsonError(400, error instanceof Error ? error.message : "업로드 요청을 처리하지 못했습니다.");
  }
});
