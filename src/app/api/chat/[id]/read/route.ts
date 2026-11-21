import { NextRequest, NextResponse } from "next/server";

import { chatMutationResultToResponse, jsonError, requireUserForApi, withErrorHandling } from "@/lib/chat/http";
import { markReadSchema } from "@/lib/chat/schema";
import { countUnreadMessagesForUser, markChatRoomRead, markMessageNotificationsReadForChatRoom } from "@/lib/chat/service";
import { enforceRateLimit, rateLimitTierFor } from "@/lib/rateLimit";

// POST /api/chat/[id]/read { upToMessageId } -- marks this room read for the
// signed-in participant, up to the newest message the client has shown, and
// clears their "message" notifications for the room. Split out of GET
// /api/chat/[id]/messages (security audit P-3, 2026-11-21) so that reading
// never changes state; as a POST it also goes through withErrorHandling's
// same-origin check (P-2).
//
// The response carries this user's fresh total unread count across every
// room (ChatThread pushes it to the header/BottomNav badge right away), and
// the cursor actually stored. Only the session user's own cursor is ever
// written; a room id the user is not part of is 403/404 (markChatRoomRead
// re-derives the participants).
export const POST = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id < 1) return jsonError(400, "id가 올바르지 않습니다.");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "요청 형식이 올바르지 않습니다.");
    }
    const parsed = markReadSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "upToMessageId가 올바르지 않습니다.");

    const limited = await enforceRateLimit("chatSync", { userId: auth.user.id, tier: await rateLimitTierFor(auth.user) });
    if (limited) return limited;

    const read = await markChatRoomRead(id, auth.user.id, parsed.data.upToMessageId);
    if (read.kind !== "ok") return chatMutationResultToResponse(read);
    await markMessageNotificationsReadForChatRoom(id, auth.user.id, parsed.data.upToMessageId);
    const unreadChatCount = await countUnreadMessagesForUser(auth.user.id);
    return NextResponse.json(
      { data: { lastReadMessageId: read.data.lastReadMessageId, unreadChatCount } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);
