import { NextRequest } from "next/server";

import {
  adminMutationResultToResponse,
  jsonError,
  requireAdminForApi,
  withErrorHandling,
} from "@/lib/moderation/http";
import { restoreTempHiddenContent } from "@/lib/moderation/service";

// POST /api/admin/reports/[id]/restore -- lifts the temporary hide that
// report [id] applied to a post or comment (Legal pre-beta Phase). Admin
// only (requireAdminForApi + the service's own isAdmin check); the
// release is recorded as its own ModerationAction.
export const POST = withErrorHandling(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireAdminForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) return jsonError(400, "id가 올바르지 않습니다.");

    const result = await restoreTempHiddenContent(auth.user, id);
    return adminMutationResultToResponse(result);
  },
);
