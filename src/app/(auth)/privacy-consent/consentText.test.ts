import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CURRENT_IDENTITY_CONSENT_VERSION, CURRENT_PRIVACY_VERSION, PRIVACY_POLICY_EFFECTIVE_DATE } from "@/lib/auth/terms";
import { ACTIVITY_RETENTION_DAYS } from "@/lib/retention/policy";
import PrivacyPolicyPage from "@/app/(policy)/policy/privacy/page";
import { ACTIVITY_RECORD_ITEM, ACTIVITY_RECORD_RETENTION, STATISTICS_PURPOSE } from "./consentText";

const policy = renderToStaticMarkup(PrivacyPolicyPage()).replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

// 동의 화면 and 개인정보처리방침 state the same 이용 통계 rules, and the
// consent version that asks for them is the policy's 시행일.
describe("동의 화면: 이용 통계", () => {
  it("names the purpose, the record and its keeping / deletion at 회원탈퇴", () => {
    expect(STATISTICS_PURPOSE).toContain("서비스 이용 통계");
    expect(ACTIVITY_RECORD_ITEM.label).toBe("이용 일자 기록");
    expect(ACTIVITY_RECORD_ITEM.detail).toContain("이용 통계");
    expect(ACTIVITY_RECORD_RETENTION).toContain(`${ACTIVITY_RETENTION_DAYS}일 동안 보관`);
    expect(ACTIVITY_RECORD_RETENTION).toContain("회원탈퇴 시에는 즉시 삭제");
  });

  it("matches the policy's rules", () => {
    expect(policy).toContain(`이용한 날로부터 ${ACTIVITY_RETENTION_DAYS}일이 지나면 매일 자동으로 삭제하고, 회원탈퇴 시에는 그 회원의 기록을 즉시 삭제합니다`);
    expect(policy).toContain("이용 통계 작성");
  });

  it("asks every member again with the new version", () => {
    expect(CURRENT_PRIVACY_VERSION).toBe(PRIVACY_POLICY_EFFECTIVE_DATE);
    expect(CURRENT_IDENTITY_CONSENT_VERSION).toBe(PRIVACY_POLICY_EFFECTIVE_DATE);
    expect(PRIVACY_POLICY_EFFECTIVE_DATE > "2026-10-14").toBe(true); // newer than the version members hold
  });
});
