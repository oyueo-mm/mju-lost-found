// 이용약관 동의 Phase: the single source of truth for "which version of
// /policy/terms is currently in force" -- a plain string constant, not a
// DB table or semver scheme, matching this app's own "현재 프로젝트 규모에
// 맞는 최소 구조" constraint (this project has exactly one terms document,
// no other versioned-document concept anywhere in this schema). Bump this
// by hand only when a change to /policy/terms actually needs every user to
// re-agree (see that page's own SECTIONS) -- a typo fix or wording polish
// doesn't need a bump. Comparison against User.termsVersion is a plain
// string equality check (see session.ts's requireReadyUser()); there is no
// automatic "is this change important enough" detection.
//
// 2026-10-03: terms art. 2 (admin-approved external members) and privacy
// policy art. 4/7 changed before the public beta -- every user re-agrees.
// 2026-10-04: terms art. 8 (계정 비활성화 및 회원탈퇴) changed.
export const CURRENT_TERMS_VERSION = "2026-10-04";

// 시행일 of the current 개인정보처리방침: the newest entry of its revision
// history (lib/policy/privacyPolicy.ts), which is kept apart from the
// consent versions below -- a policy revision never asks anyone to consent
// again by itself.
export { PRIVACY_POLICY_EFFECTIVE_DATE } from "@/lib/policy/privacyPolicy";

// "2026-10-16" -> "2026년 10월 16일" (a plain calendar day, no time zone).
export function formatEffectiveDate(isoDay: string): string {
  const [year, month, day] = isoDay.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

// 개인정보 수집·이용 동의 (the consent screen, privacy-consent/page.tsx).
// Two separate things are tracked:
//  - CURRENT_PRIVACY_VERSION: the consent screen text a new consent is
//    recorded with (User.privacyConsentVersion). Bump it whenever that
//    screen's text changes, so every record says what its member saw.
//  - ACCEPTED_PRIVACY_VERSIONS: the recorded versions that still satisfy
//    the required consent. A screen change that only explains processing
//    already covered keeps the earlier versions here (nobody is asked
//    again); only a change that needs everyone's new consent drops them,
//    and members on a dropped version see the screen once more.
// How to tell the two apart: lib/policy/privacyPolicy.ts.
//
// History (versions are the day the screen text took effect):
// 2026-10-04: 회원탈퇴 후 보유기간 (chat text 90 days, processed
// report/sanction records 1 year, ...) added.
// 2026-10-05: collected items corrected (Google sign-in returns id, e-mail
// and e-mail-verified only; IP/User-Agent/cookies listed). Terms unchanged.
// 2026-10-14: 이름·소속 are now required items of this consent (collected
// from the school Google display name), so every existing member -- with or
// without the earlier optional 실명·소속 consent -- saw the screen once more.
// 2026-10-16: the screen also states the 이용 통계 purpose, the 이용 일자
// 기록 and its keeping / deletion at 회원탈퇴 (consentText.ts), as the policy
// does. 2026-10-14 consents stay accepted: whether that processing needs
// their consent is an open legal question, not settled by this screen.
export const CURRENT_PRIVACY_VERSION = "2026-10-16";
export const ACCEPTED_PRIVACY_VERSIONS: readonly string[] = ["2026-10-16", "2026-10-14"];

// 이름·소속 수집·이용 동의: part of the required 개인정보 동의 since
// 2026-10-14 (stamped together with it by recordRequiredConsents; also
// UserIdentityInfo.consentVersion). Same two-part rule as above; its text
// did not change on 2026-10-16. "2026-10-16" is accepted because Preview
// briefly recorded it (stamped with the privacy version that day); such
// records are left as they are.
export const CURRENT_IDENTITY_CONSENT_VERSION = "2026-10-14";
export const ACCEPTED_IDENTITY_CONSENT_VERSIONS: readonly string[] = ["2026-10-14", "2026-10-16"];

export const isAcceptedPrivacyVersion = (version: string | null, accepted: readonly string[] = ACCEPTED_PRIVACY_VERSIONS) =>
  version !== null && accepted.includes(version);
export const isAcceptedIdentityConsentVersion = (version: string | null, accepted: readonly string[] = ACCEPTED_IDENTITY_CONSENT_VERSIONS) =>
  version !== null && accepted.includes(version);
