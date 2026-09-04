import type { NextResponse } from "next/server";

import { jsonError, requireUserForApi } from "@/lib/posts/http";
import type { User } from "@/generated/prisma/client";
import { isAdmin } from "./service";

export { jsonError, jsonOk, withErrorHandling } from "@/lib/posts/http";
export { adminMutationResultToResponse } from "./response";

// Route Handler gate for every /api/admin/* endpoint: must be logged in
// (requireUserForApi's usual 401/403-no-nickname checks) *and* DB-flagged
// isAdmin (see moderation/service.ts's isAdmin -- re-reads the fresh User
// row requireUserForApi() just fetched, never a client-supplied claim).
// Mirrors legacy ui/auth.py::require_admin() being a UX gate on top of
// db._require_admin(), which every admin-only service function below also
// calls itself -- so this is the first line of defense, not the only one.
export async function requireAdminForApi(): Promise<{ user: User } | { response: NextResponse }> {
  const auth = await requireUserForApi();
  if ("response" in auth) return auth;
  if (!isAdmin(auth.user)) return { response: jsonError(403, "관리자 권한이 필요합니다.") };
  return { user: auth.user };
}
