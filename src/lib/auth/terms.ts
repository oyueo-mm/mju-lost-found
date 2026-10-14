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

// 시행일 of the current 개인정보처리방침 (shown in its last article). The
// privacy and 이름·소속 consent versions below follow it, so once the real
// Production release day is fixed, changing this one line is the whole
// switch: the policy shows that day, and every member re-consents once on
// it. A day not yet reached is fine -- it is only compared for equality.
export const PRIVACY_POLICY_EFFECTIVE_DATE = "2026-10-14";

// "2026-10-16" -> "2026년 10월 16일" (a plain calendar day, no time zone).
export function formatEffectiveDate(isoDay: string): string {
  const [year, month, day] = isoDay.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

// 개인정보 수집·이용 동의 version -- compared with User.privacyConsentVersion
// the same way (plain string equality). Bump it when what the consent
// screen asks people to agree to changes (items, purposes, retention).
// 2026-10-04: 회원탈퇴 후 보유기간 (chat text 90 days, processed
// report/sanction records 1 year, ...) added.
// 2026-10-05: collected items corrected (Google sign-in returns id, e-mail
// and e-mail-verified only; IP/User-Agent/cookies listed). Terms unchanged.
// 2026-10-16: 이름·소속 are now required items of this consent (collected
// from the school Google display name), so every existing member -- with or
// without the earlier optional 실명·소속 consent -- sees the screen once more.
export const CURRENT_PRIVACY_VERSION = PRIVACY_POLICY_EFFECTIVE_DATE;

// 실명·학과 수집·이용 동의: a separate consent given on the 실명·학과 form
// (UserIdentityInfo.consentVersion). Bumping it only asks members who
// entered their details again when they next update them -- it does not
// touch CURRENT_PRIVACY_VERSION, so nobody is sent back through the
// general consent screen because of it.
// 2026-10-16: part of the required 개인정보 동의 (stamped together with it by
// recordRequiredConsents). Earlier versions were a separate, optional consent;
// a member on any of them consents again before 이름·소속 are collected.
export const CURRENT_IDENTITY_CONSENT_VERSION = PRIVACY_POLICY_EFFECTIVE_DATE;
