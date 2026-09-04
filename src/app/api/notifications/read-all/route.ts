import { jsonOk, requireUserForApi, withErrorHandling } from "@/lib/posts/http";
import { markAllNotificationsAsRead } from "@/lib/notification/service";

export const POST = withErrorHandling(async () => {
  const auth = await requireUserForApi();
  if ("response" in auth) return auth.response;

  const count = await markAllNotificationsAsRead(auth.user.id);
  return jsonOk({ count });
});
