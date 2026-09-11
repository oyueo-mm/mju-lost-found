import { NextRequest, NextResponse } from "next/server";

import { chatMutationResultToResponse, jsonError, requireUserForApi, withErrorHandling } from "@/lib/chat/http";
import { createChatRoomSchema } from "@/lib/chat/schema";
import { getOrCreateDirectChatRoom, listChatRoomsForUser } from "@/lib/chat/service";

// GET /api/chat -- every chat room the current user participates in that
// has at least one real message (채팅 탭 UX Phase -- see
// listChatRoomsForUser's own comment; a room created via "채팅 연결하기"
// but never actually messaged in is intentionally omitted here).
export const GET = withErrorHandling(async () => {
  const auth = await requireUserForApi();
  if ("response" in auth) return auth.response;

  const rooms = await listChatRoomsForUser(auth.user.id);
  return NextResponse.json({ data: rooms });
});

// POST /api/chat -- get-or-create the direct chat room between the caller
// and a post's author: { postType, postId }. Idempotent: calling it twice
// returns the same room, never a duplicate (see getOrCreateDirectChatRoom).
// Phase J-2: the Match-based `{ matchId }` shape went with the Match domain.
export const POST = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireUserForApi();
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "잘못된 요청 본문입니다.");
  }

  const parsed = createChatRoomSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
  }

  const result = await getOrCreateDirectChatRoom(parsed.data.postType, parsed.data.postId, auth.user, parsed.data.commentId);
  return chatMutationResultToResponse(result, 201);
});
