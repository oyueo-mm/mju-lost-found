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

// 개인정보 수집·이용 동의 version -- compared with User.privacyConsentVersion
// the same way (plain string equality). Bump it when what the consent
// screen asks people to agree to changes (items, purposes, retention).
// 2026-10-04: 회원탈퇴 후 보유기간 (chat text 90 days, processed
// report/sanction records 1 year, ...) added.
// 2026-10-05: collected items corrected (Google sign-in returns id, e-mail
// and e-mail-verified only; IP/User-Agent/cookies listed). Terms unchanged.
export const CURRENT_PRIVACY_VERSION = "2026-10-05";
