// 개인정보처리방침 개정 이력 -- the one place a policy revision is recorded.
// The newest entry's date is the policy's 시행일 (shown in its §11 and by
// the in-service notice, lib/policy/privacyNotice.ts); §11 lists them all.
//
// A revision is a document change. It never asks anyone to consent again
// by itself: the consent screen and its versions live apart
// (auth/terms.ts), and are changed only when the consent itself is.
//
// How a change is handled (decide per change; when unsure, have it
// reviewed rather than calling it notice-only):
//  - notice: wording, typos, clearer explanations, a processor or a
//    retention detail described more exactly, processing the policy already
//    covers, a shorter retention or a deletion added. Add an entry here
//    with consent "notice"; nothing else changes.
//  - the consent screen's text changes but what members agreed to does
//    not (it only explains more): bump CURRENT_PRIVACY_VERSION in
//    auth/terms.ts and keep the earlier version in ACCEPTED_PRIVACY_VERSIONS
//    -- new consents record exactly what they saw, no one is asked again.
//  - a change that needs everyone's new consent (a new required item, a new
//    purpose outside what was agreed and not otherwise allowed, a longer
//    retention, a new third-party provision): bump CURRENT_PRIVACY_VERSION
//    and drop the versions that no longer suffice from
//    ACCEPTED_PRIVACY_VERSIONS; members on them see the consent screen once.
//    Record it here with consent "reconsent".
//  - an optional purpose (marketing, ...) gets its own optional consent,
//    never part of the required one, and never blocks the service.
// Never add a consent for processing the service does not actually do.

export type PrivacyPolicyRevision = {
  date: string; // KST day the revision took effect on Production
  summary: string; // what changed, one sentence (shown in §11; the newest also in the notice)
  consent: "notice" | "reconsent";
};

// Newest first. The first entry's date must be the day it reaches
// Production -- set it at the release.
export const PRIVACY_POLICY_REVISIONS: readonly PrivacyPolicyRevision[] = [
  {
    date: "2026-10-16",
    summary: "서비스 이용 통계 목적과 로그인 회원의 이용 일자 기록(400일 보관, 회원탈퇴 시 삭제)을 추가하고, 처리 목적·항목을 실제 운영에 맞게 정리했습니다.",
    consent: "notice",
  },
  {
    date: "2026-10-16",
    summary: "방문 통계에 방문 시간·체류 시간·이탈 화면의 시간대·구간별 합계를 추가하고, 이를 위해 브라우저 저장소에 현재 방문의 요약을 보관한다는 내용을 8조에 추가했습니다.",
    consent: "notice",
  },
  {
    date: "2026-10-16",
    summary: "8조 방문 통계의 날짜별 합계에 접속 기기 종류(모바일·PC·태블릿·기타)를 추가했습니다.",
    consent: "notice",
  },
  {
    date: "2026-10-15",
    summary: "8조에 방문 통계용 브라우저 저장소 안내를 추가했습니다.",
    consent: "notice",
  },
  {
    date: "2026-10-14",
    summary: "이름, 소속(학과·단과대학)을 개인정보 수집·이용 동의의 필수 항목에 추가했습니다(1조).",
    consent: "reconsent",
  },
];

export const PRIVACY_POLICY_EFFECTIVE_DATE = PRIVACY_POLICY_REVISIONS[0].date;
export const LATEST_PRIVACY_POLICY_REVISION = PRIVACY_POLICY_REVISIONS[0];
