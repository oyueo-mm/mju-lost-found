import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatEffectiveDate, PRIVACY_POLICY_EFFECTIVE_DATE } from "@/lib/auth/terms";
import { ACTIVITY_RETENTION_DAYS } from "@/lib/retention/policy";
import PrivacyPolicyPage from "./page";

const html = renderToStaticMarkup(PrivacyPolicyPage());
const plainText = (value: string) => value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
const text = plainText(html);
const sections = [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].map((match) => plainText(match[1]));
const section = (n: number) => sections[n - 1];

describe("개인정보처리방침: 이용 통계", () => {
  it("names the statistics purpose and only exposes totals", () => {
    expect(section(2)).toContain("이용 통계 작성");
    expect(section(5)).toContain("회원별 이용 기록은 표시하지 않습니다");
  });

  it("lists active-day records, deletes them at withdrawal and keeps them 400 days otherwise", () => {
    expect(section(1)).toContain("회원별 이용 일자");
    const s3 = section(3);
    const deletedNow = s3.slice(s3.indexOf("회원탈퇴 시"), s3.indexOf("즉시 삭제합니다"));
    expect(deletedNow).toContain("이용 일자 기록");
    expect(section(5)).toContain(`${ACTIVITY_RETENTION_DAYS}일간 보관합니다`);
    expect(section(5)).toContain("탈퇴 시 삭제는 3항 참고");
    expect(section(5)).toContain("보관 기한 없이 탈퇴 후에도 남습니다");
  });

  it("says past active-member / revisit counts can drop after withdrawal", () => {
    expect(section(5)).toContain("지난 기간의 활성 회원·재방문 통계도 줄어들 수 있습니다");
  });

  it("keeps seven visible sections, the effective date and a collapsed history at the notice anchor", () => {
    expect(sections).toHaveLength(7);
    expect(html).not.toContain("11. 시행일 및 변경");
    const footer = text.slice(text.indexOf("시행일:"));
    expect(footer).toContain(`시행일: ${formatEffectiveDate(PRIVACY_POLICY_EFFECTIVE_DATE)}`);
    expect(footer).toContain("기존 회원에게 별도의 재동의를 요청하지 않습니다");
    expect(html).toMatch(/id="changes"[\s\S]*<details\s+class=/);
    expect(html).not.toMatch(/<details[^>]*\bopen(?:=|\s|>)/);
    expect(text).toContain("변경 안내를 닫은 시행일");
  });

  it("treats re-linkable activity records as personal data", () => {
    expect(section(5)).toContain("회원과 대조할 수 있는 개인정보로 취급하며");
  });

  it("preserves retention exceptions, cookie choices and rights contact", () => {
    expect(section(3)).toContain("탈퇴 후 90일");
    expect(section(3)).toContain("처리 완료 후 1년");
    expect(section(3)).toContain("최소 1년");
    expect(section(5)).toContain("30일 미이용");
    expect(section(5)).toContain("locale, 1년");
    expect(section(5)).toContain("anon_uid, 1년");
    expect(section(5)).toContain("브라우저 설정에서 쿠키·브라우저 저장소를 삭제하거나 차단");
    expect(section(6)).toContain("개인정보 열람·정정·삭제·처리정지");
    expect(html).toContain('href="mailto:mjusmartlostfound@gmail.com"');
  });
});
