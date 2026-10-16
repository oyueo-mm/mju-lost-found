import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatEffectiveDate, PRIVACY_POLICY_EFFECTIVE_DATE } from "@/lib/auth/terms";
import { ACTIVITY_RETENTION_DAYS } from "@/lib/retention/policy";
import PrivacyPolicyPage from "./page";

const text = renderToStaticMarkup(PrivacyPolicyPage()).replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
const section = (n: number) => text.slice(text.indexOf(`${n}. `), text.indexOf(`${n + 1}. `));

describe("개인정보처리방침: 이용 통계", () => {
  it("names the statistics purpose in §3", () => {
    expect(section(3)).toContain("이용 통계 작성");
    expect(section(3)).toContain("회원별 이용 기록은 표시하지 않습니다");
  });

  it("lists the active-day record (§1), deletes it at 회원탈퇴 (§7, §8) and keeps it 400 days otherwise", () => {
    expect(section(1)).toContain("로그인한 상태로 서비스를 이용한 날짜(이용 일자 기록");
    // among what 회원탈퇴 deletes at once, not among what it keeps
    const s7 = section(7);
    const deletedNow = s7.slice(s7.indexOf("즉시 삭제됩니다"), s7.indexOf("다음 정보는 아래 기간 동안 보관한 뒤 삭제됩니다"));
    expect(deletedNow).toContain("로그인 회원의 이용 일자 기록(아래 8조)");
    expect(s7).not.toContain("탈퇴 여부와 관계없이");
    expect(section(8)).toContain(`이용한 날로부터 ${ACTIVITY_RETENTION_DAYS}일이 지나면`);
    expect(section(8)).toContain("회원탈퇴 시에는 그 회원의 기록을 즉시 삭제합니다");
    // the hourly totals hold no member data and stay
    expect(section(8)).toContain("회원탈퇴 후에도 남습니다");
  });

  it("says past 활성 회원 / 재방문 counts can drop after a withdrawal (§3)", () => {
    expect(section(3)).toContain("지난 기간의 활성 회원 수·재방문 통계도");
  });

  it("dates the change by its own 시행일 and announces it without re-consent (§11)", () => {
    expect(section(11)).toContain(`${formatEffectiveDate(PRIVACY_POLICY_EFFECTIVE_DATE)}부터 시행합니다`);
    expect(section(11)).toContain("기존 회원에게 별도의 재동의를 요청하지 않습니다");
    expect(section(11)).not.toContain("다시 동의해야 회원 기능을");
    expect(text).toContain("변경 안내를 닫으면 닫은 안내의 시행일만"); // §8: the notice's own storage
  });

  it("never calls the re-linkable marks anonymous (§8)", () => {
    expect(section(8)).toContain("익명 정보가 아니라 개인정보로 취급합니다");
    expect(section(8)).not.toContain("가명 처리)");
  });
});
