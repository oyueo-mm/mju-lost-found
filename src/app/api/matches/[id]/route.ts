import { NextRequest } from "next/server";

import { jsonError, matchMutationResultToResponse, requireUserForApi, withErrorHandling } from "@/lib/match/http";
import { deleteMatch } from "@/lib/match/service";

export const DELETE = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      return jsonError(400, "id가 올바르지 않습니다.");
    }

    const result = await deleteMatch(id, auth.user.id);
    return matchMutationResultToResponse(result);
  },
);
