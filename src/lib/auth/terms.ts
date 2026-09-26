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
export const CURRENT_TERMS_VERSION = "2026-09-27";
