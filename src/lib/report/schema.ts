import { z } from "zod";

// Same three values as the legacy REPORT_TARGET_TYPES set and
// prisma/schema.prisma's ReportTargetType enum (@map'd to these exact
// lowercase strings). "comment" (Phase C-3) is this branch's own addition
// on top of that legacy set -- see targets.ts's resolveCommentTarget for
// why it needs no sign-encoding the way "post" does.
export const REPORT_TARGET_TYPES = ["post", "message", "user", "comment"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export const reportTargetTypeSchema = z.enum(REPORT_TARGET_TYPES);

// Same fixed list as legacy ui/common.py's REPORT_REASONS -- a selectbox in
// the legacy UI, but the DB column (Report.reason) is free TEXT with no
// CHECK constraint, so this list is a UI/API convenience only, not a
// DB-enforced enum. The API still accepts any non-blank string, matching
// db.create_report()'s actual validation (reason must not be blank, full
// stop).
// Legal pre-beta Phase: 사생활 침해, 명예훼손 and illegal sexual content
// were added. The stored value is this Korean label (Report.reason).
export const ILLEGAL_SEXUAL_CONTENT_REASON = "불법 성적 콘텐츠(불법촬영물·성착취물 등)";

export const REPORT_REASONS = [
  "사기/허위 정보",
  "부적절한 내용",
  "욕설/비방",
  "개인정보 노출",
  "사생활 침해",
  "명예훼손",
  ILLEGAL_SEXUAL_CONTENT_REASON,
  "도배/스팸",
  "기타",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

// Reports that must reach an admin first: listed ahead of every other
// pending report, flagged "긴급" in the admin UI and in the admin
// notification.
export function isUrgentReportReason(reason: string): boolean {
  return reason === ILLEGAL_SEXUAL_CONTENT_REASON;
}

// Rights-infringement reasons: a reported post or comment with one of
// these may be temporarily hidden (임시 숨김) by an admin while it's being
// reviewed (moderation/service.ts::applyReportAction).
export const RIGHTS_INFRINGEMENT_REPORT_REASONS: readonly string[] = [
  "개인정보 노출",
  "사생활 침해",
  "명예훼손",
  ILLEGAL_SEXUAL_CONTENT_REASON,
];
export function isRightsInfringementReason(reason: string): boolean {
  return RIGHTS_INFRINGEMENT_REPORT_REASONS.includes(reason);
}

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
  comment: "댓글",
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
    // Only the listed reasons -- the urgent / rights-infringement handling
    // above keys off the exact value, so it can't be free text.
    reason: z.enum(REPORT_REASONS, { message: "신고 사유를 선택해주세요." }),
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
