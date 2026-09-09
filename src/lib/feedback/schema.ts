import { z } from "zod";

// Phase 11-5: plain string-literal unions (not the Prisma enum identifiers)
// throughout the app-facing layer -- same convention every other status/
// category value in this app uses (ReportStatus, PostType, ...): the DB
// enum is an implementation detail service.ts converts to/from, never
// leaked upward as-is.
export const FEEDBACK_CATEGORIES = ["feature_request", "inconvenience", "bug", "other"] as const;
export type FeedbackCategoryValue = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_STATUSES = ["received", "in_review", "planned", "completed", "not_planned"] as const;
export type FeedbackStatusValue = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategoryValue, string> = {
  feature_request: "기능 제안",
  inconvenience: "불편사항",
  bug: "오류/버그",
  other: "기타",
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatusValue, string> = {
  received: "접수",
  in_review: "검토 중",
  planned: "반영 예정",
  completed: "반영 완료",
  not_planned: "반영하지 않음",
};

// Same title/content length convention as announcement/schema.ts's own
// createAnnouncementSchema -- both are short-to-medium admin-facing text,
// no precedent in this app for a different cap.
export const createFeedbackSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES, { message: "유형을 선택해주세요." }),
  title: z.string().trim().min(1, "제목을 입력해주세요.").max(200, "제목은 200자를 넘을 수 없습니다."),
  content: z.string().trim().min(1, "내용을 입력해주세요.").max(5000, "내용은 5000자를 넘을 수 없습니다."),
});
export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;

// Admin-only -- see feedback/service.ts::updateFeedbackStatus. adminNote is
// optional (an admin can change status without leaving a note) but, when
// present, still length-capped server-side same as every other free-text
// field in this app.
export const updateFeedbackStatusSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES, { message: "상태를 선택해주세요." }),
  adminNote: z.string().trim().max(2000, "관리자 메모는 2000자를 넘을 수 없습니다.").optional(),
});
export type UpdateFeedbackStatusInput = z.infer<typeof updateFeedbackStatusSchema>;
