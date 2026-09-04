import { NextRequest, NextResponse } from "next/server";

import { requireUserForApi, withErrorHandling } from "@/lib/posts/http";
import { listNotificationsQuerySchema } from "@/lib/notification/schema";
import { listNotifications } from "@/lib/notification/service";

// GET /api/notifications?page=&limit= -- the current user's own
// notifications only; scoped in the DB query itself (see listNotifications),
// never filtered after a broader fetch.
export const GET = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireUserForApi();
  if ("response" in auth) return auth.response;

  // page/limit both fall back to safe defaults on bad input (see
  // listNotificationsQuerySchema), so this can't fail to parse.
  const { page, limit } = listNotificationsQuerySchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  const result = await listNotifications(auth.user.id, { page, limit });

  return NextResponse.json({
    data: result.items,
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
    },
  });
});
