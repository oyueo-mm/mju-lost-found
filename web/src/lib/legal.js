// 약관·개인정보 처리방침 버전. 문서를 개정하면 이 값을 올린다 → 전원 재동의.
export const CURRENT_TERMS_VERSION = "2026-09-08";

// 개인정보 보호책임자 표기 (처리방침에 노출)
export const PRIVACY_OFFICER = "운영팀";

// 문의 창구 — 환경변수로 덮어쓸 수 있음
export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "ysm0608020@gmail.com";

export function hasAgreedToTerms(profile) {
  return (
    !!profile?.terms_agreed_at &&
    !!profile?.privacy_agreed_at &&
    profile?.terms_version === CURRENT_TERMS_VERSION
  );
}
