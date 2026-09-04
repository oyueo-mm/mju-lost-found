import { jsonError, reportLookupResultToResponse, requireUserForApi, withErrorHandling } from "@/lib/report/http";
import { getReportForUser } from "@/lib/report/service";

// GET /api/reports/[id] -- a single report, but only ever the requester's
// own. There is no way for a non-admin to see another user's report here
// (see Phase 11 spec's cross-user 403 requirement) -- admins use the
// separate /api/admin/reports/[id] endpoint instead, which re-verifies
// admin status independently.
export const GET = withErrorHandling(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) return jsonError(400, "id가 올바르지 않습니다.");

    const result = await getReportForUser(id, auth.user.id);
    return reportLookupResultToResponse(result);
  },
);
