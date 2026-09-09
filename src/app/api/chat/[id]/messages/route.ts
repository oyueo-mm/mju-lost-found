import { NextRequest, NextResponse } from "next/server";

import { chatMutationResultToResponse, jsonError, requireUserForApi, withErrorHandling } from "@/lib/chat/http";
import {
  deleteMessageQuerySchema,
  editMessageSchema,
  listMessagesQuerySchema,
  sendMessageSchema,
  toggleReactionSchema,
} from "@/lib/chat/schema";
import {
  countUnreadMessagesForUser,
  deleteMessage,
  editMessage,
  listMessages,
  markChatRoomRead,
  markMessageNotificationsReadForChatRoom,
  sendMessage,
  toggleMessageReaction,
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

    // Phase P-3: unreadChatCount is this user's fresh total across every
    // room (not just this one) right after the read above -- included here
    // so the caller (ChatThread) can push the header/BottomNav badge to
    // the correct value immediately, without waiting on a full page
    // navigation. See ChatThread.tsx's own comment on why router.refresh()
    // alone wasn't a reliable enough signal for a same-URL shared-layout
    // update in this app.
    let unreadChatCount: number | undefined;
    try {
      await markChatRoomRead(id, auth.user.id);
      await markMessageNotificationsReadForChatRoom(id, auth.user.id);
      unreadChatCount = await countUnreadMessagesForUser(auth.user.id);
    } catch (error) {
      console.error("Failed to mark chat room read on view:", error);
    }

    return NextResponse.json({
      data: result.data.items,
      pagination: { hasMore: result.data.hasMore },
      unreadChatCount,
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

    const result = await sendMessage(
      id,
      auth.user,
      parsed.data.content ?? "",
      parsed.data.imagePath,
      parsed.data.replyToMessageId,
    );
    return chatMutationResultToResponse(result, 201);
  },
);

// PATCH /api/chat/[id]/messages -- two different bodies share this same
// route/function rather than a new one (see this phase's own
// function-count constraint, and Phase 32's image search sharing
// /api/posts via a `mode` field the same way):
//   { messageId, emoji }   -- toggles the caller's own reaction (unchanged)
//   { messageId, content } -- edits the caller's own message text (Phase P-6)
// Told apart by shape (`content` in body means "edit"), never a userId/
// senderId from the body either way -- both dispatch to a service function
// that re-derives the actual actor from the authenticated session.
export const PATCH = withErrorHandling(
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

    if (body && typeof body === "object" && "content" in body) {
      const parsed = editMessageSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
      }
      const result = await editMessage(id, parsed.data.messageId, auth.user.id, parsed.data.content);
      return chatMutationResultToResponse(result);
    }

    const parsed = toggleReactionSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }

    const result = await toggleMessageReaction(id, parsed.data.messageId, parsed.data.emoji, auth.user);
    return chatMutationResultToResponse(result);
  },
);

// DELETE /api/chat/[id]/messages?messageId= -- soft-deletes ("삭제") the
// caller's own message (or, for an admin, any message in the room -- see
// chat/service.ts::deleteMessage's own comment). Same file as GET/POST/
// PATCH above, no new route -- messageId is a query param since this
// resource is the room's message list, not one specific message.
export const DELETE = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      return jsonError(400, "id가 올바르지 않습니다.");
    }

    const parsed = deleteMessageQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }

    const result = await deleteMessage(id, parsed.data.messageId, auth.user);
    return chatMutationResultToResponse(result);
  },
);
