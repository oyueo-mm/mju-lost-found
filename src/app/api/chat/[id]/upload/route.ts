import { NextRequest } from "next/server";
import { z } from "zod";

import { jsonError, jsonOk, requireUserForApi, withErrorHandling } from "@/lib/chat/http";
import { getChatRoomForUser } from "@/lib/chat/service";
import { isAllowedImageContentType } from "@/lib/images/config";
import { buildChatImagePathname } from "@/lib/images/pathname";
import { createSignedUploadUrl } from "@/lib/images/supabaseAdmin";

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

    const pathname = buildChatImagePathname(chatRoomId, contentType);

    try {
      const { path, token } = await createSignedUploadUrl(pathname);
      return jsonOk({ path, token });
    } catch (error) {
      console.error("Failed to create signed upload URL for chat image:", error);
      return jsonError(502, "업로드 준비 중 오류가 발생했습니다.");
    }
  },
);
