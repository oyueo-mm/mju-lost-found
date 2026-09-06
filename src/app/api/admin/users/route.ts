import { NextRequest } from "next/server";

import { requireAdminForApi, withErrorHandling } from "@/lib/moderation/http";
import { adminUserMutationResultToResponse } from "@/lib/admin/response";
import { listUsersForAdminQuerySchema } from "@/lib/admin/schema";
import { listUsersForAdmin } from "@/lib/admin/users";

// GET /api/admin/users?q=&page=&limit= -- admin-only user list/search.
// requireAdminForApi() gates this (401/403), and listUsersForAdmin()
// re-checks isAdmin() itself regardless -- same belt-and-suspenders
// pattern api/admin/reports/route.ts already uses.
export const GET = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireAdminForApi();
  if ("response" in auth) return auth.response;

  const query = listUsersForAdminQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const result = await listUsersForAdmin(auth.user, query);
  return adminUserMutationResultToResponse(result);
});
