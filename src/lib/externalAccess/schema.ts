import { z } from "zod";

export const EXTERNAL_ACCESS_CAMPUSES = ["인문캠퍼스", "자연캠퍼스", "양쪽"] as const;
export type ExternalAccessCampus = (typeof EXTERNAL_ACCESS_CAMPUSES)[number];

const detailsSchema = {
  name: z.string().trim().min(1, "이름 또는 설명을 입력해주세요.").max(100, "이름 또는 설명은 100자 이내로 입력해주세요."),
  affiliation: z.string().trim().min(1, "소속/역할을 입력해주세요.").max(100, "소속/역할은 100자 이내로 입력해주세요."),
  campus: z.enum(EXTERNAL_ACCESS_CAMPUSES, { message: "캠퍼스를 선택해주세요." }),
};

export const createExternalAccessSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("올바른 이메일 주소를 입력해주세요.")
    .max(254),
  ...detailsSchema,
}).superRefine((input, ctx) => {
  if (input.email.endsWith("@mju.ac.kr")) ctx.addIssue({ code: "custom", path: ["email"], message: "명지대학교 계정은 로그인 승인 없이 이용할 수 있습니다. 기관 담당자는 별도 관리 화면에서 지정해주세요." });
});
export type CreateExternalAccessInput = z.infer<typeof createExternalAccessSchema>;

export const updateExternalAccessSchema = z.object(detailsSchema);
export type UpdateExternalAccessInput = z.infer<typeof updateExternalAccessSchema>;
