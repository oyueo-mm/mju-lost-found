import { NextRequest, NextResponse } from "next/server";

import { chatMutationResultToResponse, jsonError, requireUserForApi, withErrorHandling } from "@/lib/chat/http";
import { listMessagesQuerySchema, sendMessageSchema } from "@/lib/chat/schema";
import {
  listMessages,
  markMessageNotificationsReadForChatRoom,
  markMessagesAsRead,
  sendMessage,
} from "@/lib/chat/service";

// GET /api/chat/[id]/messages?before= -- oldest-first page of messages,
// only for a participant (listMessages re-verifies). Mirrors the legacy
// chat page's own sequence: entering/paging through a room also marks
// the *other* participant's messages (and their own "message"
// notifications) as read -- done here, right after a successful fetch,
// since that's this app's equivalent of "the page was rendered". A
// failure in that best-effort step is logged but never turns an
// otherwise-successful message fetch into an error.
export const GET = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const id = Number(idParam);
    const query = listMessagesQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!Number.isInteger(id) || !query.success) {
      return jsonError(400, "id 또는 before가 올바르지 않습니다.");
    }

    const result = await listMessages(id, auth.user.id, query.data.before);
    if (result.kind !== "ok") {
      return chatMutationResultToResponse(result);
    }

    try {
      await markMessagesAsRead(id, auth.user.id);
      await markMessageNotificationsReadForChatRoom(id, auth.user.id);
    } catch (error) {
      console.error("Failed to mark chat room read on view:", error);
    }

    return NextResponse.json({
      data: result.data.items,
      pagination: { hasMore: result.data.hasMore },
    });
  },
);

// POST /api/chat/[id]/messages { content } -- the sender is always the
// authenticated current user (see sendMessage), never a value from the
// request body.
export const POST = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      return jsonError(400, "id가 올바르지 않습니다.");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "잘못된 요청 본문입니다.");
    }

    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }

    const result = await sendMessage(id, auth.user, parsed.data.content);
    return chatMutationResultToResponse(result, 201);
  },
);
