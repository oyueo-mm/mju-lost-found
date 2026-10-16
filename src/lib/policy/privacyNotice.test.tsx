import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const cookieSet = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet }) }));

import { PRIVACY_POLICY_EFFECTIVE_DATE } from "@/lib/auth/terms";
import { PrivacyPolicyNotice } from "@/components/layout/PrivacyPolicyNotice";
import { dismissPrivacyNoticeAction } from "@/app/privacyNoticeActions";
import {
  PRIVACY_NOTICE_COOKIE,
  PRIVACY_NOTICE_DAYS,
  PRIVACY_NOTICE_STORAGE_KEY,
  privacyNotice,
  privacyNoticeDismissed,
  privacyNoticeInitScript,
} from "./privacyNotice";

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
    const run = (stored: string | null, cookie = "") => {
      const attrs: Record<string, string> = {};
      const g = {
        localStorage: { getItem: (k: string) => (k === PRIVACY_NOTICE_STORAGE_KEY ? stored : null) },
        document: { cookie, documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
        location: { protocol: "https:" },
      };
      new Function("localStorage", "document", "location", privacyNoticeInitScript("2026-10-16"))(g.localStorage, g.document, g.location);
      return { attr: attrs["data-privacy-notice"], cookie: g.document.cookie };
    };
    expect(run("2026-10-16").attr).toBe("closed");
    expect(run("2026-09-01").attr).toBeUndefined();
    expect(run(null).attr).toBeUndefined();
    // an earlier close (storage only) is copied into the cookie once
    expect(run("2026-10-16").cookie).toBe(`${PRIVACY_NOTICE_COOKIE}=2026-10-16; path=/; max-age=31536000; samesite=lax; secure`);
    expect(run("2026-10-16", `a=1; ${PRIVACY_NOTICE_COOKIE}=2026-10-16`).cookie).toBe(`a=1; ${PRIVACY_NOTICE_COOKIE}=2026-10-16`);
    expect(run(null, "a=1").cookie).toBe("a=1");
  });

  it("is left out by the server once closed for this 시행일 (cookie), and asks again for the next one", async () => {
    expect(privacyNoticeDismissed("2026-10-16", "2026-10-16")).toBe(true);
    expect(privacyNoticeDismissed("2026-09-01", "2026-10-16")).toBe(false);
    expect(privacyNoticeDismissed(undefined, "2026-10-16")).toBe(false);

    await dismissPrivacyNoticeAction(PRIVACY_POLICY_EFFECTIVE_DATE);
    expect(cookieSet).toHaveBeenCalledWith(PRIVACY_NOTICE_COOKIE, PRIVACY_POLICY_EFFECTIVE_DATE, expect.objectContaining({ path: "/", maxAge: 31536000, sameSite: "lax", httpOnly: true }));
    cookieSet.mockClear();
    await dismissPrivacyNoticeAction("2099-01-01");
    await dismissPrivacyNoticeAction({ evil: true });
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
