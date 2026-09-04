import { NextRequest } from "next/server";

import { chatMutationResultToResponse, jsonError, requireUserForApi, withErrorHandling } from "@/lib/chat/http";
import { getChatRoomForUser } from "@/lib/chat/service";

// GET /api/chat/[id] -- room detail, only for a participant. Knowing
// another user's chat room id is never enough on its own (see
// getChatRoomForUser, which re-derives participants from the DB).
export const GET = withErrorHandling(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      return jsonError(400, "id가 올바르지 않습니다.");
    }

    const result = await getChatRoomForUser(id, auth.user.id);
    return chatMutationResultToResponse(result);
  },
);
