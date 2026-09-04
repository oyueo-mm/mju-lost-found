import { jsonOk, requireUserForApi, withErrorHandling } from "@/lib/posts/http";
import { getUnreadNotificationCount } from "@/lib/notification/service";

export const GET = withErrorHandling(async () => {
  const auth = await requireUserForApi();
  if ("response" in auth) return auth.response;

  const count = await getUnreadNotificationCount(auth.user.id);
  return jsonOk({ count });
});
