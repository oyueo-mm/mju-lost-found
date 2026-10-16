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
  // History-page presentation only; summary remains the full notice text.
  history?: { summary: string; before: string; after: string };
};

// Newest first. The first entry's date must be the day it reaches
// Production -- set it at the release.
export const PRIVACY_POLICY_REVISIONS: readonly PrivacyPolicyRevision[] = [
  {
    date: "2026-10-17",
    summary:
      "관리자 사용자 상세에 최근 이용 시각(로그인 상태의 가장 최근 활동 시각 1개, 최대 5분 간격으로 덮어씀, 회원탈퇴 시 삭제)을 표시하고, 시간대별 이용 회원 수 합계와 변경 안내를 닫은 기록(쿠키, 1년)을 안내에 추가했습니다.",
    consent: "notice",
    history: {
      summary: "최근 이용 시각·시간대별 이용 회원 수·안내 닫기 쿠키 안내",
      before: "관리자 사용자 상세에 최근 이용일(날짜)만 표시, 시간대별 로그인 횟수·조회 수 합계",
      after: "최근 이용 시각 1개 저장·관리자 상세 표시(탈퇴 시 삭제), 시간대별 이용 회원 수 합계, 안내 닫기 쿠키(1년)",
    },
  },
  {
    date: "2026-10-16",
    summary: "회원별 이용 일자 통계(400일 보관, 회원탈퇴 시 삭제)를 안내하고, 처리방침을 간소화했습니다. 개인정보 문의처·처리 지역·백업 안내와 추가 이용 판단 기준을 보완했습니다.",
    consent: "notice",
    history: {
      summary: "회원별 이용 일자: 400일 보관·탈퇴 시 삭제 안내",
      before: "회원별 이용 일자 보관·삭제 안내 없음",
      after: "이용 통계 목적, 400일 보관·탈퇴 시 삭제 명시",
    },
  },
  {
    date: "2026-10-16",
    summary: "방문 통계에 방문 시간·체류 시간·이탈 화면의 시간대·구간별 합계를 추가하고, 이를 위해 브라우저 저장소에 현재 방문의 요약을 보관한다는 내용을 8조에 추가했습니다.",
    consent: "notice",
    history: {
      summary: "방문 시간대·체류 시간·첫/마지막 화면 집계 추가",
      before: "조회·방문 수, 기기·유입 경로 등 합계 안내",
      after: "방문 시간대·체류 시간·첫/마지막 화면 집계와 방문 요약 저장 안내 추가",
    },
  },
  {
    date: "2026-10-16",
    summary: "8조 방문 통계의 날짜별 합계에 접속 기기 종류(모바일·PC·태블릿·기타)를 추가했습니다.",
    consent: "notice",
    history: {
      summary: "접속 기기 종류별 방문 통계 추가",
      before: "기기 종류별 통계 안내 없음",
      after: "모바일·PC·태블릿·기타별 합계 안내 추가",
    },
  },
  {
    date: "2026-10-15",
    summary: "8조에 방문 통계용 브라우저 저장소 안내를 추가했습니다.",
    consent: "notice",
    history: {
      summary: "방문 통계·브라우저 저장소 사용 안내 추가",
      before: "방문 통계용 브라우저 저장소 별도 안내 없음",
      after: "방문 통계용 저장소 사용과 삭제·차단 선택권 안내",
    },
  },
  {
    date: "2026-10-14",
    summary: "이름, 소속(학과·단과대학)을 개인정보 수집·이용 동의의 필수 항목에 추가했습니다(1조).",
    consent: "reconsent",
    history: {
      summary: "이름·소속 수집을 필수 동의로 변경",
      before: "이름·소속 별도 선택 동의",
      after: "개인정보 수집·이용의 필수 동의에 포함",
    },
  },
];

export const PRIVACY_POLICY_EFFECTIVE_DATE = PRIVACY_POLICY_REVISIONS[0].date;
export const LATEST_PRIVACY_POLICY_REVISION = PRIVACY_POLICY_REVISIONS[0];
