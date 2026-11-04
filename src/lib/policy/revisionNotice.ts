import { LATEST_PRIVACY_POLICY_REVISION } from "./privacyPolicy";
import { TERMS_REVISIONS } from "./termsRevisions";

// 이용약관·개인정보처리방침 변경 안내 (Phase 3-B): one in-app notification per
// member, through the existing Notification table -- type ANNOUNCEMENT,
// relatedType "policy_revision", relatedId = this revision's number. The
// table's unique (user, type, relatedType, relatedId) makes a second send
// for the same revision a no-op, so a member gets it once.
//
// Reading it is not consent to anything: it only links to /policy/changes.
// A revision that needs new consent goes through the consent screen
// (auth/terms.ts versions), never through this notice.
//
// Sent by scripts/policy/notify-revision.mjs (explicit user ids on Preview;
// all members on Production only with an explicit flag).
export const POLICY_REVISION_NOTICE = {
  relatedType: "policy_revision",
  // YYYYMMDD of the revision; a new revision gets a new number
  relatedId: 20261105,
  effectiveDate: LATEST_PRIVACY_POLICY_REVISION.date,
  termsEffectiveDate: TERMS_REVISIONS[0].date,
  // stored text (Korean, like every stored notification); the list shows the
  // reader's language instead (notifications/page.tsx)
  title: "이용약관 및 개인정보처리방침 변경 안내",
  content: "감사 후기 기능과 회원 탈퇴 시 후기 처리 기준이 추가되었습니다. 변경 내용을 확인해 주세요.",
} as const;

export const POLICY_CHANGES_PATH = "/policy/changes";
