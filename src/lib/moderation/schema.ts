import { z } from "zod";

// Same three values as legacy MODERATION_ACTION_TYPES and
// prisma/schema.prisma's ModerationActionType enum.
export const MODERATION_ACTION_TYPES = ["delete_post", "hide_message", "suspend_user"] as const;
export type ModerationActionTypeValue = (typeof MODERATION_ACTION_TYPES)[number];

export const MODERATION_ACTION_TYPE_LABELS: Record<ModerationActionTypeValue, string> = {
  delete_post: "게시물 삭제",
  hide_message: "메시지 숨김",
  suspend_user: "사용자 정지",
};

// The one action_type valid for each Report.targetType -- enforced in
// applyReportAction(), mirrors legacy's _TARGET_TYPE_TO_ACTION_TYPES. Also
// used by the admin UI to know which action a given report's target
// implies (there's exactly one valid choice per target type, never a
// free pick).
import type { ReportTargetType } from "@/lib/report/schema";
export const TARGET_TYPE_TO_ACTION_TYPE: Record<ReportTargetType, ModerationActionTypeValue> = {
  post: "delete_post",
  message: "hide_message",
  user: "suspend_user",
};

// Same three choices as legacy's SUSPEND_DURATION_OPTIONS ("7일"/"30일"/
// "영구") -- undefined/omitted in the request means permanent (no
// suspendedUntil), matching apply_report_action(suspend_duration_days=None).
export const SUSPEND_DURATION_DAY_OPTIONS = [7, 30] as const;

// A single endpoint (POST /api/admin/reports/[id]/process) dispatches to
// legacy's two distinct admin decisions: db.process_report(status=
// "dismissed") and db.apply_report_action(...) -- combining them behind
// one discriminated body keeps the API surface small while still calling
// the exact right underlying operation for each decision. See the Phase
// 11 report for why this shape was chosen over two separate endpoints.
export const processReportSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("dismiss"),
    adminNote: z.string().trim().max(2000).optional(),
  }),
  z.object({
    decision: z.literal("action"),
    actionReason: z.string().trim().max(500).optional(),
    adminNote: z.string().trim().max(2000).optional(),
    suspendDurationDays: z.coerce.number().int().positive().optional(),
  }),
]);
export type ProcessReportInput = z.infer<typeof processReportSchema>;

export const REPORT_STATUSES_FOR_FILTER = ["pending", "dismissed", "actioned"] as const;
export const REPORT_TARGET_TYPES_FOR_FILTER = ["post", "message", "user"] as const;

export const DEFAULT_ADMIN_PAGE = 1;
export const DEFAULT_ADMIN_LIMIT = 20;
export const MAX_ADMIN_LIMIT = 50;

export const listReportsForAdminQuerySchema = z.object({
  status: z.enum(REPORT_STATUSES_FOR_FILTER).optional(),
  targetType: z.enum(REPORT_TARGET_TYPES_FOR_FILTER).optional(),
  page: z.coerce.number().int().min(1).catch(DEFAULT_ADMIN_PAGE),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .catch(DEFAULT_ADMIN_LIMIT)
    .transform((n) => Math.min(n, MAX_ADMIN_LIMIT)),
});
