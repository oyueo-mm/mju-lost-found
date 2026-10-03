import { NextRequest, NextResponse } from "next/server";

import { jsonError, requireUserForApi, withErrorHandling } from "@/lib/chat/http";
import { getChatImageForViewer } from "@/lib/chat/service";
import { createChatImageSignedUrl } from "@/lib/images/chatStorage";

// Neither the browser nor any shared cache may keep this response: it is a
// per-viewer authorization decision, and the redirect target is a signed
// URL that expires in CHAT_IMAGE_URL_TTL_SECONDS.
const NO_STORE = "private, no-store, max-age=0";

// GET /api/chat/[id]/messages/[messageId]/image -- the only way a chat
// image is ever served. Chat images live in the private chat-images
// bucket; this checks the signed-in viewer against the room
// (getChatImageForViewer: participant, or an admin with a MESSAGE report
// for this room via ?report=) and only then redirects to
// a short-lived signed URL. 401 without a session, 403 for a non-
// participant, 404 for a message that isn't in this room, has no image, or
// was hidden/deleted.
export const GET = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) {
      auth.response.headers.set("Cache-Control", NO_STORE);
      return auth.response;
    }

    const { id: idParam, messageId: messageIdParam } = await params;
    const chatRoomId = Number(idParam);
    const messageId = Number(messageIdParam);
    if (!Number.isInteger(chatRoomId) || !Number.isInteger(messageId)) {
      return withNoStore(jsonError(400, "id가 올바르지 않습니다."));
    }

    // ?report= is only used for an admin who isn't a participant: the
    // image is then served (and logged) only for a MESSAGE report in this
    // room.
    const reportParam = request.nextUrl.searchParams.get("report");
    const reportId = reportParam !== null && /^\d+$/.test(reportParam) ? Number(reportParam) : undefined;
    const access = await getChatImageForViewer(chatRoomId, messageId, auth.user, reportId);
    if (access.kind === "forbidden") return withNoStore(jsonError(403, "이 이미지를 볼 권한이 없습니다."));
    if (access.kind === "not_found") return withNoStore(jsonError(404, "이미지를 찾을 수 없습니다."));

    const signedUrl = await createChatImageSignedUrl(access.path);
    const response = NextResponse.redirect(signedUrl, 302);
    response.headers.set("Cache-Control", NO_STORE);
    // The signed URL (in Location) shouldn't travel further as a referrer.
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  },
);

function withNoStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", NO_STORE);
  return response;
}
