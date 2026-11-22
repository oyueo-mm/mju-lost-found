import { NextRequest } from "next/server";
import { z } from "zod";

import { jsonError, jsonOk, requireIdentityForApi, requireUserForApi, withErrorHandling } from "@/lib/chat/http";
import { getChatRoomForUser } from "@/lib/chat/service";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { CHAT_IMAGES_BUCKET, isAllowedImageContentType } from "@/lib/images/config";
import { buildChatImagePathname } from "@/lib/images/pathname";
import { createChatImageUploadUrl } from "@/lib/images/chatStorage";
import { enforceRateLimit, rateLimitTierFor } from "@/lib/rateLimit";
import { canOpenUpload, recordUploadIntent } from "@/lib/images/uploadIntents";

const requestSchema = z.object({ contentType: z.string() });

// Mints a short-lived, path-scoped signed upload URL/token for the same
// Supabase Storage bucket post images already use (see
// src/app/api/upload/route.ts's own doc comment for why the file's bytes
// never pass through this server). The only thing this route does
// differently from that one is the authorization check: instead of "do
// you own this post", it's "are you a participant of this chat room" --
// reusing getChatRoomForUser() (chat/service.ts), the exact same
// membership check every other chat read/write path in this app already
// goes through, so a user can't mint an upload token for a room they're
// not in.
export const POST = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;
    const identityMissing = await requireIdentityForApi(auth.user);
    if (identityMissing) return identityMissing;
    // Release C (M-1): sendMessage() refuses a suspended sender, so a token
    // would only ever create an orphan upload -- refuse it up front, like
    // /api/upload already does for post images.
    if (isCurrentlySuspended(auth.user)) return jsonError(403, "정지된 계정은 이 기능을 사용할 수 없습니다.");

    const { id: idParam } = await params;
    const chatRoomId = Number(idParam);
    if (!Number.isInteger(chatRoomId)) return jsonError(400, "id가 올바르지 않습니다.");

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
    const { contentType } = parsed.data;

    if (!isAllowedImageContentType(contentType)) {
      return jsonError(400, "JPEG, PNG, WebP 형식만 업로드할 수 있습니다.");
    }

    const room = await getChatRoomForUser(chatRoomId, auth.user.id);
    if (room.kind !== "ok") {
      return jsonError(403, "이 채팅방에 이미지를 업로드할 권한이 없습니다.");
    }

    // Same counter as post photos (/api/upload), so the same tier -- staff
    // who just uploaded a batch of post photos are not cut off in chat.
    const tier = await rateLimitTierFor(auth.user);
    const limited = await enforceRateLimit("imageUpload", { userId: auth.user.id, tier });
    if (limited) return limited;
    // Security audit A-3: a cap on uploads not yet attached to anything.
    if (!(await canOpenUpload(auth.user.id, tier))) return jsonError(429, "첨부하지 않은 사진이 너무 많아요. 작성 중인 글이나 채팅에 사진을 첨부하거나, 하루 뒤에 다시 시도해주세요.");

    const pathname = buildChatImagePathname(chatRoomId, contentType);

    try {
      await recordUploadIntent(auth.user.id, CHAT_IMAGES_BUCKET, pathname);
      // Private chat-images bucket -- never the public post-images one.
      const { path, token } = await createChatImageUploadUrl(pathname);
      return jsonOk({ path, token });
    } catch (error) {
      console.error("Failed to create signed upload URL for chat image:", error);
      return jsonError(502, "업로드 준비 중 오류가 발생했습니다.");
    }
  },
);
