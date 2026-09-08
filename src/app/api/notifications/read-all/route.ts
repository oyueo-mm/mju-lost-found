import { NextResponse } from "next/server";

import { requireUserForApi, withErrorHandling } from "@/lib/posts/http";
import { getUnreadNotificationCount, markAllNotificationsAsRead } from "@/lib/notification/service";

// Phase P-3: also returns unreadNotificationCount (always 0 right after
// this succeeds) -- same fresh-count-in-response fix as PATCH/DELETE
// /api/notifications/[id]. MarkAllReadButton.tsx dispatches it to the
// header bell badge directly instead of relying on router.refresh().
export const POST = withErrorHandling(async () => {
  const auth = await requireUserForApi();
  if ("response" in auth) return auth.response;

  const count = await markAllNotificationsAsRead(auth.user.id);
  const unreadNotificationCount = await getUnreadNotificationCount(auth.user.id);
  return NextResponse.json({ data: { count }, unreadNotificationCount });
});
