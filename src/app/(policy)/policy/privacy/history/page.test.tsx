import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import archive from "@/lib/policy/archives/b46ba45.json";
import { PRIVACY_POLICY_REVISIONS } from "@/lib/policy/privacyPolicy";
import ArchivedPrivacyPolicyPage from "./b46ba45/page";
import PrivacyPolicyHistoryPage from "./page";

describe("이전 개인정보처리방침과 변경 내역", () => {
  it("shows five short table rows with dates, and keeps the full archive behind a link", () => {
    const html = renderToStaticMarkup(PrivacyPolicyHistoryPage());
    expect(html).toContain('href="/policy/privacy"');
    expect(html).toContain('href="/policy/privacy/history/b46ba45"');
    const table = html.match(/<table\b[^>]*>([\s\S]*?)<\/table>/)![1];
    expect([...html.matchAll(/<table\b/g)]).toHaveLength(1);
    expect([...table.matchAll(/<tr\b/g)]).toHaveLength(PRIVACY_POLICY_REVISIONS.length + 1);
    for (const revision of PRIVACY_POLICY_REVISIONS) {
      expect(table).toContain(revision.date);
      expect(table).toContain(revision.history!.summary);
      expect(table).not.toContain(revision.summary);
    }
    expect(html).not.toContain("11개 조항");
    expect(html).not.toContain("7개 섹션");
    expect(html).not.toContain(archive.sectionsHtml);
    expect(html).not.toContain("11. 시행일 및 변경");
    expect(html).toContain("개정별 전문을 대신하지 않습니다");
  });

  it("keeps actual processing comparisons and original summaries in closed details", () => {
    const html = renderToStaticMarkup(PrivacyPolicyHistoryPage());
    expect(html).not.toMatch(/<details[^>]*\bopen(?:=|\s|>)/);
    const details = html.match(/<details\b[^>]*>([\s\S]*?)<\/details>/)![1];
    expect(details).toContain("변경 전후 및 상세 내역");
    for (const revision of PRIVACY_POLICY_REVISIONS) {
      expect(details).toContain(revision.summary);
      expect(details).toContain(revision.history!.before);
      expect(details).toContain(revision.history!.after);
    }
    expect(details).toContain("이름·소속 별도 선택 동의");
    expect(details).toContain("개인정보 수집·이용의 필수 동의에 포함");
    expect(details).toContain("400일 보관·탈퇴 시 삭제");
  });

  it("serves a frozen, sourced archive with all eleven original sections", () => {
    const html = renderToStaticMarkup(ArchivedPrivacyPolicyPage());
    expect(archive.sourceCommit).toBe("b46ba457d7669449b511997b39fc7af41e5d31f9");
    expect(archive.sourceBlob).toBe("bee68df14cb0863ea4e40488510abb278bf7e5ef");
    expect(archive.effectiveDate).toBe("2026-10-16");
    expect(html).toContain(archive.sectionsHtml);
    expect([...html.matchAll(/<section\b/g)]).toHaveLength(11);
    expect(html).toContain("11. 시행일 및 변경");
    expect(html).toContain("2026년 10월 16일부터 시행합니다");
    expect(html).toContain('href="/policy/privacy/history"');
    expect(html).toContain('href="/policy/privacy"');
  });
});
