import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ACCEPTED_PRIVACY_VERSIONS, CURRENT_PRIVACY_VERSION } from "@/lib/auth/terms";
import { ACTIVITY_RETENTION_DAYS } from "@/lib/retention/policy";
import PrivacyPolicyPage from "@/app/(policy)/policy/privacy/page";
import { ACTIVITY_RECORD_ITEM, ACTIVITY_RECORD_RETENTION, COLLECTED_ITEMS, STATISTICS_PURPOSE } from "./consentText";

// The consent screen's text belongs to one consent version: a record of
// version V means its member saw V's text. Changing the text therefore
// needs a new CURRENT_PRIVACY_VERSION (auth/terms.ts) -- keep the earlier
// one in ACCEPTED_PRIVACY_VERSIONS unless everyone must consent again --
// and its fingerprint here.
const SCREEN_FINGERPRINTS: Record<string, string> = {
  "2026-10-16": "124b88fcedc572eb",
};

const fingerprint = () =>
  createHash("sha256").update(JSON.stringify([COLLECTED_ITEMS, STATISTICS_PURPOSE, ACTIVITY_RECORD_RETENTION])).digest("hex").slice(0, 16);

describe("동의 화면 문구와 동의 버전", () => {
  it("is the text of the current consent version (changed text -> new version)", () => {
    expect(SCREEN_FINGERPRINTS[CURRENT_PRIVACY_VERSION], "consent screen text changed: bump CURRENT_PRIVACY_VERSION and record the new fingerprint").toBe(fingerprint());
    expect(ACCEPTED_PRIVACY_VERSIONS).toContain(CURRENT_PRIVACY_VERSION);
  });

  it("states the 이용 통계 purpose, the record and its keeping / deletion, as the policy does", () => {
    expect(STATISTICS_PURPOSE).toContain("서비스 이용 통계");
    expect(COLLECTED_ITEMS).toContain(ACTIVITY_RECORD_ITEM);
    expect(ACTIVITY_RECORD_RETENTION).toContain(`${ACTIVITY_RETENTION_DAYS}일 동안 보관`);
    expect(ACTIVITY_RECORD_RETENTION).toContain("회원탈퇴 시에는 즉시 삭제");
    const policy = renderToStaticMarkup(PrivacyPolicyPage()).replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
    expect(policy).toContain(`이용한 날로부터 ${ACTIVITY_RETENTION_DAYS}일간 보관합니다`);
    expect(policy).toContain("보관기간이 지난 정보는 매일 자동 정리");
    expect(policy).toMatch(/회원탈퇴 시[^。]*이용 일자 기록[^。]*즉시 삭제합니다/);
    // every item the screen lists is one the policy names too
    for (const label of ["Google 계정", "이메일", "닉네임", "이름·소속", "게시글", "댓글", "채팅 메시지", "이용 일자 기록"]) {
      expect(policy).toContain(label);
    }
  });
});
