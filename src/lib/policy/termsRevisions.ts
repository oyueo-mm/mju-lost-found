// 이용약관 개정 이력 -- kept apart from the consent version, exactly like the
// privacy policy's (lib/policy/privacyPolicy.ts). CURRENT_TERMS_VERSION in
// auth/terms.ts is what members agreed to; bumping it sends everyone back
// to the terms screen, so it changes only for a revision marked
// "reconsent". A "notice" revision (explaining a service the terms already
// cover, adding no obligation) is announced and takes effect on its date.
export type TermsRevision = {
  date: string; // KST day the revision took effect on Production
  summary: string;
  consent: "notice" | "reconsent";
};

// Newest first. The first entry's date must be the day it reaches
// Production -- set it at the release.
export const TERMS_REVISIONS: readonly TermsRevision[] = [
  {
    // Preview: set to the actual KST day it reaches Production
    date: "2026-11-05",
    summary: "3조에 감사 후기를, 6조에 감사 후기의 작성·전달·공개 방식을 추가했습니다(새 의무 없음).",
    consent: "notice",
  },
  {
    date: "2026-10-04",
    summary: "8조(계정 비활성화 및 회원탈퇴)를 변경했습니다.",
    consent: "reconsent",
  },
];

export const TERMS_EFFECTIVE_DATE = TERMS_REVISIONS[0].date;
