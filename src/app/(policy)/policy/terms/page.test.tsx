import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TermsPolicyPage from "./page";

describe("공통 이용약관: 외부 관계자", () => {
  it("keeps approved external access without stating that external users cannot be admins", () => {
    const text = renderToStaticMarkup(TermsPolicyPage()).replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
    expect(text).toContain("관리자가 승인한 외부 관계자");
    expect(text).toContain("이용 권한을 부여할 수 있습니다");
    expect(text).not.toContain("외부 관계자에게는 관리자 권한이 부여되지");
    expect(text).not.toContain("승인이 취소되면 서비스 이용이 제한될 수 있습니다");
    expect(text).toContain("수집·이용 동의가 필요합니다");
  });
});
