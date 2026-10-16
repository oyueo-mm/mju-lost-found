import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PRIVACY_POLICY_EFFECTIVE_DATE } from "@/lib/auth/terms";
import { PrivacyPolicyNotice } from "@/components/layout/PrivacyPolicyNotice";
import { PRIVACY_NOTICE_DAYS, PRIVACY_NOTICE_STORAGE_KEY, privacyNotice, privacyNoticeInitScript } from "./privacyNotice";

describe("개인정보처리방침 변경 안내", () => {
  it("is upcoming before the 시행일, then changed, and ends after the notice period", () => {
    expect(privacyNotice("2026-10-20", "2026-10-23")?.text).toBe("개인정보처리방침이 2026년 10월 23일부터 변경됩니다.");
    expect(privacyNotice("2026-10-23", "2026-10-23")?.text).toBe("개인정보처리방침이 2026년 10월 23일에 변경되었습니다.");
    expect(privacyNotice("2026-11-21", "2026-10-23")).not.toBeNull(); // day 29
    expect(privacyNotice("2026-11-22", "2026-10-23")).toBeNull(); // 30 days after
    expect(PRIVACY_NOTICE_DAYS).toBe(30);
  });

  it("follows the policy's 시행일 and links to its change history", () => {
    const notice = privacyNotice(PRIVACY_POLICY_EFFECTIVE_DATE)!;
    expect(notice.id).toBe(PRIVACY_POLICY_EFFECTIVE_DATE);
    expect(notice.href).toBe("/policy/privacy#changes");
    expect(notice.summary).toContain("400일 보관, 회원탈퇴 시 삭제");
  });

  it("renders a non-blocking bar: text, link and a close button, no dialog", () => {
    const html = renderToStaticMarkup(<PrivacyPolicyNotice notice={privacyNotice("2026-10-16", "2026-10-16")!} />);
    expect(html).toContain('href="/policy/privacy#changes"');
    expect(html).toContain('aria-label="변경 안내 닫기"');
    expect(html).toContain("data-privacy-notice-bar");
    expect(html).not.toMatch(/role="(dialog|alertdialog)"|aria-modal/);
  });

  it("hides a bar closed for this 시행일 before first paint, and shows the next one again", () => {
    const run = (stored: string | null) => {
      const attrs: Record<string, string> = {};
      const g = {
        localStorage: { getItem: (k: string) => (k === PRIVACY_NOTICE_STORAGE_KEY ? stored : null) },
        document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
      };
      new Function("localStorage", "document", privacyNoticeInitScript("2026-10-16"))(g.localStorage, g.document);
      return attrs["data-privacy-notice"];
    };
    expect(run("2026-10-16")).toBe("closed");
    expect(run("2026-09-01")).toBeUndefined();
    expect(run(null)).toBeUndefined();
  });
});
