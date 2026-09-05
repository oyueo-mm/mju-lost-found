import { NextRequest, NextResponse } from "next/server";

import { chatMutationResultToResponse, jsonError, requireUserForApi, withErrorHandling } from "@/lib/chat/http";
import { createChatRoomSchema } from "@/lib/chat/schema";
import { getOrCreateChatRoomForMatch, getOrCreateDirectChatRoom, listChatRoomsForUser } from "@/lib/chat/service";

// GET /api/chat -- every chat room (Match-based or direct, Phase 10) the
// current user participates in.
export const GET = withErrorHandling(async () => {
  const auth = await requireUserForApi();
  if ("response" in auth) return auth.response;

  const rooms = await listChatRoomsForUser(auth.user.id);
  return NextResponse.json({ data: rooms });
});

// POST /api/chat -- get-or-create a chat room, either shape:
//   { matchId }                -- the single ChatRoom for a Match.
//   { postType, postId }       -- Phase 10: a direct room with that post's
//                                  author, no Match required.
// Both are idempotent: calling either twice returns the same room, never
// a duplicate (see getOrCreateChatRoomForMatch/getOrCreateDirectChatRoom).
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

  const result =
    "matchId" in parsed.data
      ? await getOrCreateChatRoomForMatch(parsed.data.matchId, auth.user.id)
      : await getOrCreateDirectChatRoom(parsed.data.postType, parsed.data.postId, auth.user);
  return chatMutationResultToResponse(result, 201);
});
