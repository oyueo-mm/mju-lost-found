import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import archive from "@/lib/policy/archives/b46ba45.json";
import ArchivedPrivacyPolicyPage from "./b46ba45/page";
import PrivacyPolicyHistoryPage from "./page";

describe("이전 개인정보처리방침과 변경 내역", () => {
  it("links to the current policy and the actual archived text, with a comparison", () => {
    const html = renderToStaticMarkup(PrivacyPolicyHistoryPage());
    expect(html).toContain('href="/policy/privacy"');
    expect(html).toContain('href="/policy/privacy/history/b46ba45"');
    expect(html).toContain("<table");
    expect(html).toContain("11개 조항");
    expect(html).toContain("7개 섹션");
    expect(html).toContain("개인정보 처리 정책은 유지");
    expect(html).toContain("각 개정 당시 원문이나 실제 배포 여부");
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
