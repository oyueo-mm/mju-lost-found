import { NextRequest } from "next/server";

import {
  adminMutationResultToResponse,
  jsonError,
  requireAdminForApi,
  withErrorHandling,
} from "@/lib/moderation/http";
import { processReportSchema, TARGET_TYPE_TO_ACTION_TYPE } from "@/lib/moderation/schema";
import { applyReportAction, dismissReport, getReportTargetType } from "@/lib/moderation/service";

// POST /api/admin/reports/[id]/process { decision: "dismiss" | "action", ... }
// -- dispatches to legacy's two distinct admin decisions: db.process_report
// ("dismiss") and db.apply_report_action ("action"). requestingAdminUserId
// is always the authenticated session admin (never a body field), and the
// action's actionType is always derived server-side from the report's own
// targetType (see getReportTargetType) -- never accepted from the client,
// so a caller can't request e.g. suspend_user against a post report.
export const POST = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireAdminForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) return jsonError(400, "id가 올바르지 않습니다.");

    const body = await request.json();
    const parsed = processReportSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, parsed.error.issues[0]?.message ?? "요청이 올바르지 않습니다.");
    }

    if (parsed.data.decision === "dismiss") {
      const result = await dismissReport(auth.user, id, parsed.data.adminNote);
      return adminMutationResultToResponse(result);
    }

    const targetType = await getReportTargetType(id);
    if (!targetType) return jsonError(404, "신고를 찾을 수 없습니다.");

    const { actionReason, adminNote, suspendDurationDays } = parsed.data;
    const result = await applyReportAction(auth.user, id, TARGET_TYPE_TO_ACTION_TYPE[targetType], {
      actionReason,
      adminNote,
      suspendDurationDays,
    });
    return adminMutationResultToResponse(result, 201);
  },
);
