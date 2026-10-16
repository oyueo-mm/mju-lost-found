import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ACTIVITY_RETENTION_DAYS } from "@/lib/retention/policy";
import PrivacyPolicyPage from "./page";

const text = renderToStaticMarkup(PrivacyPolicyPage()).replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
const section = (n: number) => text.slice(text.indexOf(`${n}. `), text.indexOf(`${n + 1}. `));

describe("개인정보처리방침: 이용 통계", () => {
  it("names the statistics purpose in §3", () => {
    expect(section(3)).toContain("이용 통계 작성");
    expect(section(3)).toContain("회원별 이용 기록은 표시하지 않고");
  });

  it("states the code's retention of the active-day marks, also after 회원탈퇴 (§7, §8)", () => {
    expect(section(7)).toContain(`로그인 회원의 이용 일자 기록(아래 8조): 탈퇴 여부와 관계없이 이용한 날로부터 ${ACTIVITY_RETENTION_DAYS}일`);
    expect(section(8)).toContain(`이용한 날로부터 ${ACTIVITY_RETENTION_DAYS}일이 지나면`);
  });

  it("never calls the re-linkable marks anonymous (§8)", () => {
    expect(section(8)).toContain("익명 정보가 아니라 개인정보로 취급합니다");
    expect(section(8)).not.toContain("가명 처리)");
  });
});
