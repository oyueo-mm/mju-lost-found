import { NextRequest } from "next/server";

import { adminMutationResultToResponse, requireAdminForApi, withErrorHandling } from "@/lib/moderation/http";
import { listReportsForAdminQuerySchema } from "@/lib/moderation/schema";
import { listReportsForAdmin } from "@/lib/moderation/service";

// GET /api/admin/reports?status=&targetType=&page=&limit= -- admin-only
// report queue. requireAdminForApi() gates this (401/403), and
// listReportsForAdmin() re-checks isAdmin() itself regardless -- never
// trusts a single gate to be the only thing standing between a non-admin
// and this data.
export const GET = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireAdminForApi();
  if ("response" in auth) return auth.response;

  const query = listReportsForAdminQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const result = await listReportsForAdmin(auth.user, query);
  return adminMutationResultToResponse(result);
});
