import { z } from "zod";

export const CUSTODY_STATES = {
  OTHER: "기타",
  SELF: "본인이 직접 보관 중",
  PLANNED: "기관 전달 예정",
  REPORTED: "기관에 전달함 (작성자 신고)",
  UNKNOWN: "보관 위치 모름",
  UNHELD: "보관하지 않음",
} as const;
// Input examples only (datalist), never presented as official drop-off
// points: which offices actually keep lost items has not been confirmed.
export const CUSTODY_PLACES = ["교내 경비실", "학생지원팀", "도서관 관련 관리 기관"] as const;
export const MANAGEMENT_ACTION_LABELS: Record<string, string> = {
  confirm: "접수 확인", location: "보관 장소 변경", complete: "찾음·반환 완료", reopen: "완료 복구",
  transfer_request: "기관 인계 요청", transfer_accept: "기관 인계 수령 완료", transfer_cancel: "기관 인계 취소",
  correct_institution: "관리 기관 정정", release: "잘못된 접수 확인 해제",
  owner_status: "작성자 상태 변경", owner_custody: "작성자 보관 정보 변경",
};
// Phase 3-A: the form now offers three answers -- 직접 보관 (SELF), 기관에
// 맡김 (REPORTED: already handed over) and 기타 (OTHER: the finder's own
// words, kept in `note`) -- and the whole question is optional (no custody
// at all = null). PLANNED / UNKNOWN / UNHELD are no longer offered but stay
// valid: posts that already have them keep their exact meaning (a plan is
// never read as a hand-over), and the form only re-sends custody when the
// finder actually changes it.
// A registered 관리 기관 (Organization with a managementCampus), offered as a
// 기관에 맡김 suggestion for its campus.
export type CustodyInstitution = { name: string; campus: string };
export const CUSTODY_STATE_VALUES = ["SELF", "PLANNED", "REPORTED", "UNKNOWN", "UNHELD", "OTHER"] as const;
export type CustodyState = (typeof CUSTODY_STATE_VALUES)[number];
export const CUSTODY_NOTE_MAX = 200;
export const custodyInputSchema = z.object({
  state: z.enum(CUSTODY_STATE_VALUES),
  place: z.string().trim().max(200).default(""),
  note: z.string().trim().max(CUSTODY_NOTE_MAX).optional(),
// The place is optional for PLANNED (not decided yet) and REPORTED (the
// finder does not know where it is kept): an unknown place is stored empty,
// never guessed. 기타 needs its text -- an empty 기타 is not a state.
}).strict().superRefine((v, ctx) => {
  if (v.state === "OTHER" && !v.note) ctx.addIssue({ code: "custom", path: ["note"], message: "현재 보관 상태를 입력하거나 선택을 해제해주세요." });
}).transform((v): { state: CustodyState; place: string; note?: string } => ({
  state: v.state,
  place: v.state === "PLANNED" || v.state === "REPORTED" ? v.place : "",
  ...(v.state === "OTHER" && { note: v.note ?? "" }),
}));
export type CustodyInput = z.infer<typeof custodyInputSchema>;
export type CustodyInfo = CustodyInput & { confirmedAt: string | null; confirmedBy: number | null; institution: string | null };
// The finder-entered part of stored custody, as the input schema shapes it
// (note only for 기타) -- used when the server re-writes custody unchanged.
export function custodyInputOf(info: CustodyInput): CustodyInput {
  return { state: info.state, place: info.place, ...(info.state === "OTHER" && { note: info.note ?? "" }) };
}
export function readCustody(raw: unknown): CustodyInfo | null {
  const parsed = custodyInputSchema.safeParse(
    raw && typeof raw === "object"
      ? { state: (raw as CustodyInput).state, place: (raw as CustodyInput).place, ...((raw as CustodyInput).note !== undefined && { note: (raw as CustodyInput).note }) }
      : raw,
  );
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


// What the post page shows about where a found item is, as translation keys
// (see post.custody.* in lib/i18n/messages). null = nothing was entered: the
// page says so instead of guessing. A finder's report is never shown as an
// institution's confirmed receipt, and a plan (PLANNED) is never shown as a
// hand-over (REPORTED).
export type CustodyView = {
  stateKey: string;
  // a finder's own words (기타) are shown as written, untranslated
  stateText?: string;
  place?: string;
  placeKey?: string;
  noteKey?: string;
  institution?: string;
};
export function custodyView(custody: CustodyInfo | null, completed: boolean): CustodyView | null {
  if (completed) return { stateKey: "post.custody.state.returned" };
  if (!custody) return null;
  if (custody.confirmedAt) {
    return { stateKey: "post.custody.state.institutionConfirmed", ...(custody.place ? { place: custody.place } : { placeKey: "post.custody.place.unregistered" }), noteKey: "post.custody.note.confirmed", institution: custody.institution ?? undefined };
  }
  switch (custody.state) {
    case "SELF":
      return { stateKey: "post.custody.state.self", noteKey: "post.custody.note.self" };
    case "REPORTED":
      return { stateKey: "post.custody.state.reported", ...(custody.place ? { place: custody.place } : { placeKey: "post.custody.place.unknown" }), noteKey: "post.custody.note.reported" };
    case "PLANNED":
      return { stateKey: "post.custody.state.planned", ...(custody.place ? { place: custody.place } : { placeKey: "post.custody.place.undecided" }) };
    case "UNHELD":
      return { stateKey: "post.custody.state.unheld" };
    case "OTHER":
      return { stateKey: "post.custody.state.other", stateText: custody.note ?? "" };
    default:
      return { stateKey: "post.custody.state.unknown" };
  }
}

// The form's three answers, and where an existing post's state sits among
// them: an older PLANNED / UNHELD / UNKNOWN shows under 기타 with its original
// meaning spelled out, and is kept as it is unless the finder changes it.
export type CustodyChoice = "self" | "handed" | "other";
export function custodyChoiceOf(custody: Pick<CustodyInput, "state"> | null): CustodyChoice | null {
  if (!custody) return null;
  return custody.state === "SELF" ? "self" : custody.state === "REPORTED" ? "handed" : "other";
}
export function isLegacyCustodyState(state: CustodyState): boolean {
  return state === "PLANNED" || state === "UNHELD" || state === "UNKNOWN";
}
