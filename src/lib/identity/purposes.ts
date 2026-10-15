// Why an admin views a member's 이름·소속 -- exactly the purposes the privacy
// policy (§5) and the 이름·소속 consent name. Stored in
// IdentityAccessLog.purpose (a DB CHECK constraint allows only these).
//
// - "report": a report in which the member is the reporter or the reported
//   party (the log names the report);
// - the operating purposes below: no report, but a concrete case an admin
//   has to settle -- and only for a member who agreed to the consent that
//   names these purposes (see viewIdentityForPurpose).
export const OPERATING_IDENTITY_PURPOSES = ["handover", "ownership_dispute", "impersonation"] as const;
export type OperatingIdentityPurpose = (typeof OPERATING_IDENTITY_PURPOSES)[number];
export type IdentityViewPurpose = "report" | OperatingIdentityPurpose;

export const IDENTITY_PURPOSE_LABELS: Record<IdentityViewPurpose, string> = {
  report: "신고 처리",
  handover: "분실물 인계 문의 확인",
  ownership_dispute: "소유권 분쟁 조정",
  impersonation: "사칭 의심 확인",
};

export function isOperatingIdentityPurpose(value: unknown): value is OperatingIdentityPurpose {
  return typeof value === "string" && (OPERATING_IDENTITY_PURPOSES as readonly string[]).includes(value);
}
