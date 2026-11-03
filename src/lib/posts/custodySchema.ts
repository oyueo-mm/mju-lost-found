import { z } from "zod";

export const CUSTODY_STATES = {
  SELF: "본인이 직접 보관 중",
  PLANNED: "기관 전달 예정",
  REPORTED: "기관에 전달함 (작성자 신고)",
  UNKNOWN: "보관 위치 모름",
  UNHELD: "보관하지 않음",
} as const;
export const CUSTODY_PLACES = ["교내 경비실", "학생지원팀", "도서관 관련 관리 기관", "기타 장소"] as const;
export const MANAGEMENT_ACTION_LABELS: Record<string, string> = {
  confirm: "접수 확인", location: "보관 장소 변경", complete: "찾음·반환 완료", reopen: "완료 복구",
  transfer_request: "기관 인계 요청", transfer_accept: "기관 인계 수령 완료", transfer_cancel: "기관 인계 취소",
  correct_institution: "관리 기관 정정", release: "잘못된 접수 확인 해제",
  owner_status: "작성자 상태 변경", owner_custody: "작성자 보관 정보 변경",
};
export const custodyInputSchema = z.object({
  state: z.enum(["SELF", "PLANNED", "REPORTED", "UNKNOWN", "UNHELD"]),
  place: z.string().trim().max(200).default(""),
}).strict().superRefine((v, ctx) => {
  if ((v.state === "PLANNED" || v.state === "REPORTED") && !v.place) {
    ctx.addIssue({ code: "custom", path: ["place"], message: "전달할 곳 또는 전달한 장소를 입력해주세요." });
  }
}).transform((v) => ({ ...v, place: v.state === "SELF" || v.state === "UNKNOWN" || v.state === "UNHELD" ? "" : v.place }));
export type CustodyInput = z.infer<typeof custodyInputSchema>;
export type CustodyInfo = CustodyInput & { confirmedAt: string | null; confirmedBy: number | null; institution: string | null };
export function readCustody(raw: unknown): CustodyInfo | null {
  const parsed = custodyInputSchema.safeParse(raw && typeof raw === "object" ? { state: (raw as CustodyInput).state, place: (raw as CustodyInput).place } : raw);
  if (!parsed.success) return null;
  const v = raw as Record<string, unknown>;
  return { ...parsed.data, confirmedAt: typeof v.confirmedAt === "string" ? v.confirmedAt : null,
    confirmedBy: typeof v.confirmedBy === "number" ? v.confirmedBy : null,
    institution: typeof v.institution === "string" ? v.institution : null };
}
export const managementSchema = z.object({
  action: z.enum(["confirm", "location", "complete", "reopen", "transfer_request", "transfer_accept", "transfer_cancel", "correct_institution", "release"]),
  expectedUpdatedAt: z.iso.datetime(),
  place: z.string().trim().min(1).max(200).optional(),
  organizationId: z.number().int().positive().optional(),
  reason: z.string().trim().max(500).optional(),
  confirmed: z.literal(true, "실제 접수 또는 반환 여부를 확인해주세요."),
}).strict().superRefine((v, ctx) => {
  if ((v.action === "confirm" || v.action === "location") && !v.place) ctx.addIssue({ code: "custom", path: ["place"], message: "실제 보관 장소를 입력해주세요." });
  if (["reopen", "correct_institution", "release"].includes(v.action) && !v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "정정·복구 사유를 입력해주세요." });
  if (["transfer_request", "correct_institution"].includes(v.action) && !v.organizationId) ctx.addIssue({ code: "custom", path: ["organizationId"], message: "대상 기관을 선택해주세요." });
  if (["transfer_accept", "correct_institution"].includes(v.action) && !v.place) ctx.addIssue({ code: "custom", path: ["place"], message: "실제 보관 장소를 입력해주세요." });
});
