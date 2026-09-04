import { NextRequest } from "next/server";

import {
  createReportResultToResponse,
  jsonError,
  jsonOk,
  requireUserForApi,
  withErrorHandling,
} from "@/lib/report/http";
import { createReportSchema } from "@/lib/report/schema";
import { createReport, listReportsForUser } from "@/lib/report/service";

// GET /api/reports -- the current user's own filed reports only. Mirrors
// legacy list_reports_by_reporter(): always scoped to the caller, no
// pagination (a single user's report history is never large).
export const GET = withErrorHandling(async () => {
  const auth = await requireUserForApi();
  if ("response" in auth) return auth.response;

  const reports = await listReportsForUser(auth.user.id);
  return jsonOk(reports);
});

// POST /api/reports { targetType, targetId, reason, detail? } -- files a
// report. All target validation (exists, not a self-report) and duplicate
// prevention happens in createReport(); reporterUserId is always the
// authenticated session user, never anything from the request body.
export const POST = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireUserForApi();
  if ("response" in auth) return auth.response;

  const body = await request.json();
  const parsed = createReportSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "요청이 올바르지 않습니다.");
  }

  const result = await createReport(auth.user, parsed.data);
  return createReportResultToResponse(result);
});
