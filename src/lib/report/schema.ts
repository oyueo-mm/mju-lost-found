import { z } from "zod";

// Same three values as the legacy REPORT_TARGET_TYPES set and
// prisma/schema.prisma's ReportTargetType enum (@map'd to these exact
// lowercase strings).
export const REPORT_TARGET_TYPES = ["post", "message", "user"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export const reportTargetTypeSchema = z.enum(REPORT_TARGET_TYPES);

// Same fixed list as legacy ui/common.py's REPORT_REASONS -- a selectbox in
// the legacy UI, but the DB column (Report.reason) is free TEXT with no
// CHECK constraint, so this list is a UI/API convenience only, not a
// DB-enforced enum. The API still accepts any non-blank string, matching
// db.create_report()'s actual validation (reason must not be blank, full
// stop).
export const REPORT_REASONS = [
  "사기/허위 정보",
  "부적절한 내용",
  "욕설/비방",
  "개인정보 노출",
  "도배/스팸",
  "기타",
] as const;

export const REPORT_STATUSES = ["pending", "dismissed", "actioned"] as const;
export type ReportStatusValue = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABELS: Record<ReportStatusValue, string> = {
  pending: "처리 대기",
  dismissed: "반려",
  actioned: "조치 완료",
};

export const REPORT_TARGET_TYPE_LABELS: Record<ReportTargetType, string> = {
  post: "게시물",
  message: "메시지",
  user: "사용자",
};

// targetId is signed for target_type="post": positive = LostPost id,
// negative = -(FoundPost id) -- see db._validate_report_target()'s exact
// comment. LostPost.id/FoundPost.id are independent AUTOINCREMENT
// sequences that both start at 1, so without this encoding the same
// target_id would commonly collide between the two tables. message/user
// ids are real, always-positive ids, so no such encoding is needed there.
export const createReportSchema = z
  .object({
    targetType: reportTargetTypeSchema,
    targetId: z.coerce.number().int("targetId가 올바르지 않습니다."),
    reason: z.string().trim().min(1, "신고 사유를 입력해주세요.").max(200),
    detail: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.targetType === "post" || v.targetId > 0, {
    message: "targetId가 올바르지 않습니다.",
    path: ["targetId"],
  })
  .refine((v) => v.targetType !== "post" || v.targetId !== 0, {
    message: "targetId가 올바르지 않습니다.",
    path: ["targetId"],
  });
export type CreateReportInput = z.infer<typeof createReportSchema>;
