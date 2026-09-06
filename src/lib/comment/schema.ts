import { z } from "zod";

// Deliberately no separate "title" field or rich content -- a lost & found
// comment is a short plain-text note ("혹시 도서관 2층에서 잃어버리신
//건가요?"), not a full post. 1000 chars mirrors this project's other
// free-text bodies (Report.detail, ModerationAction.reason) rather than
// inventing a new limit.
export const createCommentSchema = z.object({
  content: z.string().trim().min(1, "댓글 내용을 입력해주세요.").max(1000),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = createCommentSchema;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
