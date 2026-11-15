import { NextRequest } from "next/server";
import { requireAdminForApi, jsonError, jsonOk, withErrorHandling } from "@/lib/moderation/http";
import { retryReportEvidence } from "@/lib/report/evidenceRetry";

export const POST = withErrorHandling(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireAdminForApi("reports.view");
  if ("response" in auth) return auth.response;
  if (request.headers.get("origin") !== request.nextUrl.origin) return jsonError(403, "같은 사이트에서만 요청할 수 있습니다.");
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return jsonError(400, "잘못된 신고 번호입니다.");
  return await retryReportEvidence(auth.user, id) ? jsonOk({ retried: true }) : jsonError(409, "처리 대기 중인 신고의 사진만 다시 시도할 수 있습니다.");
});
