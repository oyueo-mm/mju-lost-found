import { NextRequest } from "next/server";

import { requireAdminForApi, withErrorHandling } from "@/lib/moderation/http";
import { adminPostMutationResultToResponse } from "@/lib/admin/response";
import { listPostsForAdminQuerySchema } from "@/lib/admin/schema";
import { listPostsForAdmin } from "@/lib/admin/posts";

// GET /api/admin/posts?type=lost|found&q=&category=&authorQuery=&page=&limit=
// -- admin-only post list/search, reusing listLostPosts/listFoundPosts
// (posts/service.ts) unchanged. requireAdminForApi() gates this (401/403),
// and listPostsForAdmin() re-checks isAdmin() itself regardless -- same
// pattern api/admin/reports/route.ts and api/admin/users/route.ts already use.
export const GET = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireAdminForApi();
  if ("response" in auth) return auth.response;

  const query = listPostsForAdminQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const result = await listPostsForAdmin(auth.user, query);
  return adminPostMutationResultToResponse(result);
});
