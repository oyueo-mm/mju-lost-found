import { NextRequest, NextResponse } from "next/server";

import { chatMutationResultToResponse, jsonError, requireUserForApi, withErrorHandling } from "@/lib/chat/http";
import { createChatRoomSchema } from "@/lib/chat/schema";
import { getOrCreateChatRoomForMatch, listChatRoomsForUser } from "@/lib/chat/service";

// GET /api/chat -- every Match-based chat room the current user
// participates in (owner of the Match's LostPost and/or FoundPost side).
export const GET = withErrorHandling(async () => {
  const auth = await requireUserForApi();
  if ("response" in auth) return auth.response;

  const rooms = await listChatRoomsForUser(auth.user.id);
  return NextResponse.json({ data: rooms });
});

// POST /api/chat { matchId } -- get-or-create the single ChatRoom for a
// Match. Idempotent: calling this twice for the same match returns the
// same room, never a duplicate (see getOrCreateChatRoomForMatch).
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

  const result = await getOrCreateChatRoomForMatch(parsed.data.matchId, auth.user.id);
  return chatMutationResultToResponse(result, 201);
});
