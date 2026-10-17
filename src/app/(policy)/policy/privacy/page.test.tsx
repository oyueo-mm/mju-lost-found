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

  it("lists the one stored 최근 이용 시각: overwritten, no history, admin user detail only, deleted at withdrawal", () => {
    expect(section(1)).toContain("최근 이용 시각");
    const s3 = section(3);
    expect(s3.slice(s3.indexOf("회원탈퇴 시"), s3.indexOf("즉시 삭제합니다"))).toContain("최근 이용 시각");
    expect(section(5)).toContain("최근 이용 시각: 로그인 상태로 화면을 보거나 조작한 가장 최근 시각을 회원 계정에 하나만 저장합니다");
    expect(section(5)).toContain("최대 5분 간격으로 덮어쓰며 이력은 남기지 않음");
    expect(section(5)).toContain("관리자 사용자 상세 보기에만 표시하며(관리자 계정은 7항의 관리자 활동 화면에도 표시), 회원탈퇴 시 삭제합니다");
    expect(section(5)).toContain("날짜·시간대별 로그인 횟수·조회 수·이용 회원 수");
  });

  it("says past active-member / revisit counts can drop after withdrawal", () => {
    expect(section(5)).toContain("지난 기간의 활성 회원·재방문 통계도 줄어들 수 있습니다");
  });

  it("keeps seven visible sections and only the date and history link at the notice anchor", () => {
    expect(sections).toHaveLength(7);
    expect(html).not.toContain("11. 시행일 및 변경");
    const footer = text.slice(text.indexOf("시행일:"));
    expect(footer).toContain(`시행일: ${formatEffectiveDate(PRIVACY_POLICY_EFFECTIVE_DATE)}`);
    expect(footer).toContain("이전 개인정보처리방침 및 변경 내역");
    expect(html).toMatch(/id="changes"[\s\S]*href="\/policy\/privacy\/history"/);
    expect(html).not.toContain("<details");
    expect(footer).not.toContain("재동의");
    expect(text).toContain("변경 안내를 닫은 시행일");
  });

  it("treats re-linkable activity records as personal data", () => {
    expect(section(5)).toContain("회원과 대조할 수 있는 개인정보로 취급하며");
    expect(section(5)).toContain("관리자 사용자 상세 보기에서는 보관 중인 기록의 최근 이용일(날짜만)");
  });

  it("discloses the 관리자 운영 작업 기록: what, why, 1 year, and who sees each admin's records", () => {
    expect(section(1)).toContain("관리자 조치·열람 기록");
    expect(section(3)).toContain("관리자의 운영 작업 기록(작업 관리자·작업 종류·대상 번호·시각)");
    expect(section(3)).toContain("작업 후 1년");
    expect(section(5)).toContain("관리자 계정의 기록은 7항의 관리자 활동 화면에도 표시합니다");
    const s7 = section(7);
    expect(s7).toContain("관리 업무 점검과 권한 오남용 방지");
    expect(s7).toContain("내용은 저장하지 않고 작업 후 1년간 보관합니다");
    expect(s7).toContain("각 관리자는 본인 기록만, 지정된 상위 관리자는 전체 관리자의 기록을 볼 수 있습니다");
    // sign-ins and visits: times only, 1 year, no screens / clicks / search text / chat
    expect(section(3)).toContain("관리자의 로그인·방문 기록(로그인 시각, 방문 시작·마지막 활동 시각)");
    expect(section(3)).toContain("로그인·마지막 활동 후 1년");
    expect(s7).toContain("로그인 시각과 방문(로그인 상태로 30분 이상 쉬지 않고 이용한 구간)의 시작·마지막 활동 시각도 1년간 기록합니다");
    expect(s7).toContain("방문한 화면, 클릭, 검색어, 채팅 내용은 기록하지 않습니다");
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

  it("names the actual student-run privacy contact without inventing a phone or a school department", () => {
    expect(section(7)).toContain("MJU Find 운영팀");
    expect(section(7)).toContain("학생들이 자체 운영하는 서비스");
    expect(section(7)).toContain("학교 공식 부서가 아닙니다");
    expect(html).not.toContain('href="tel:');
  });

  it("discloses all four additional-use criteria and distinguishes regional hosting from overseas processing", () => {
    for (const criterion of ["원래 수집 목적과의 관련성", "예측 가능성", "이용자의 이익을 부당하게", "안전조치"]) {
      expect(section(2)).toContain(criterion);
    }
    expect(section(2)).toContain("별도의 동의 등 적법한 근거가 필요합니다");
    expect(section(4)).toContain("서버 함수와 주 데이터베이스·파일 저장소는 서울 지역");
    expect(section(4)).toContain("EU 데이터센터의 로그 처리");
    expect(section(4)).toContain("별도 플랫폼·보안 기록의 보관기간과 같지는 않습니다");
    expect(html).toContain('href="mailto:privacy@vercel.com"');
    expect(html).toContain('href="mailto:privacy@supabase.io"');
  });
});
