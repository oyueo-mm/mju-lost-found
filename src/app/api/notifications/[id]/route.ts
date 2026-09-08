import { NextRequest, NextResponse } from "next/server";

import { jsonError, requireUserForApi, withErrorHandling } from "@/lib/posts/http";
import { deleteNotification, getUnreadNotificationCount, markNotificationAsRead } from "@/lib/notification/service";

// PATCH /api/notifications/[id] -- marks one notification read. Ownership
// is re-checked against the DB (see markNotificationAsRead); knowing
// another user's notification id is not enough to touch it.
//
// Phase P-3: also returns this user's fresh unreadNotificationCount
// alongside the updated notification -- NotificationItem.tsx dispatches it
// to the header bell badge directly, the same fix already applied to
// chat's unread badge (see ChatThread.tsx's own comment on why
// router.refresh() alone wasn't a reliable signal for a same-URL shared-
// layout update).
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
      case "ok": {
        const unreadNotificationCount = await getUnreadNotificationCount(auth.user.id);
        return NextResponse.json({ data: result.data, unreadNotificationCount });
      }
      case "not_found":
        return jsonError(404, "알림을 찾을 수 없습니다.");
      case "forbidden":
        return jsonError(403, "본인의 알림만 확인할 수 있습니다.");
    }
  },
);

// Phase E-2: DELETE /api/notifications/[id] -- hard-deletes one
// notification. Same file/route as PATCH above (no new API route -- see
// this phase's own function-count constraint), same ownership re-check
// pattern (deleteNotification re-verifies against the DB regardless of
// what the client claims).
export const DELETE = withErrorHandling(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      return jsonError(400, "id가 올바르지 않습니다.");
    }

    const result = await deleteNotification(id, auth.user.id);
    switch (result.kind) {
      case "ok": {
        // Phase P-3: deleting an unread notification also lowers the
        // count -- same fresh-count-in-response fix as PATCH above.
        const unreadNotificationCount = await getUnreadNotificationCount(auth.user.id);
        return NextResponse.json({ data: result.data, unreadNotificationCount });
      }
      case "not_found":
        return jsonError(404, "알림을 찾을 수 없습니다.");
      case "forbidden":
        return jsonError(403, "본인의 알림만 삭제할 수 있습니다.");
    }
  },
);
