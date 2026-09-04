import { NextRequest } from "next/server";

import { jsonError, jsonOk, requireUserForApi, withErrorHandling } from "@/lib/posts/http";
import { markNotificationAsRead } from "@/lib/notification/service";

// PATCH /api/notifications/[id] -- marks one notification read. Ownership
// is re-checked against the DB (see markNotificationAsRead); knowing
// another user's notification id is not enough to touch it.
export const PATCH = withErrorHandling(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      return jsonError(400, "id가 올바르지 않습니다.");
    }

    const result = await markNotificationAsRead(id, auth.user.id);
    switch (result.kind) {
      case "ok":
        return jsonOk(result.data);
      case "not_found":
        return jsonError(404, "알림을 찾을 수 없습니다.");
      case "forbidden":
        return jsonError(403, "본인의 알림만 확인할 수 있습니다.");
    }
  },
);
