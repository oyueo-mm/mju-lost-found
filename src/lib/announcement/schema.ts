import { z } from "zod";

// Same shape/limits convention as posts/schema.ts's title/description
// (min(1) required, a sane max length) -- announcements are short admin
// notices, not long-form content, so the same 200/5000 caps used there
// are reused rather than inventing new numbers.
export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(1, "제목을 입력해주세요.").max(200, "제목은 200자를 넘을 수 없습니다."),
  content: z.string().trim().min(1, "내용을 입력해주세요.").max(5000, "내용은 5000자를 넘을 수 없습니다."),
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

// Same fields, same rules -- editing never changes which fields exist.
export const updateAnnouncementSchema = createAnnouncementSchema;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
