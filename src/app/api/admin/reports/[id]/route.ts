import {
  adminMutationResultToResponse,
  jsonError,
  requireAdminForApi,
  withErrorHandling,
} from "@/lib/moderation/http";
import { getReportForAdmin } from "@/lib/moderation/service";

// GET /api/admin/reports/[id] -- admin-only report detail, including
// target info (post/message/user summary) and any existing
// ModerationAction. Same double-gate as the list endpoint.
export const GET = withErrorHandling(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireAdminForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) return jsonError(400, "id가 올바르지 않습니다.");

    const result = await getReportForAdmin(auth.user, id);
    return adminMutationResultToResponse(result);
  },
);
