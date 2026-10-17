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
  closedIn,
  cookieValueOf,
  isPrivacyNoticeClosed,
  privacyNoticeDismissed,
  privacyNoticeInitScript,
  recordPrivacyNoticeClosed,
  subscribePrivacyNotice,
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
    expect(notice.summary).toContain("최근 이용 시각");
    expect(notice.summary).toContain("회원탈퇴 시 삭제");
  });

  it("renders a non-blocking bar: text, link and a close button, no dialog", () => {
    const html = renderToStaticMarkup(<PrivacyPolicyNotice notice={privacyNotice("2026-10-16", "2026-10-16")!} />);
    expect(html).toContain('href="/policy/privacy#changes"');
    expect(html).toContain('aria-label="변경 안내 닫기"');
    expect(html).toContain("data-privacy-notice-bar");
    expect(html).not.toMatch(/role="(dialog|alertdialog)"|aria-modal/);
  });

  it("hides a bar closed for this 시행일 before first paint -- by localStorage or cookie -- and brings the two in step", () => {
    const run = (stored: string | null, cookie = "") => {
      const attrs: Record<string, string> = {};
      const store = { value: stored };
      const g = {
        localStorage: { getItem: (k: string) => (k === PRIVACY_NOTICE_STORAGE_KEY ? store.value : null), setItem: (_k: string, v: string) => (store.value = v) },
        document: { cookie, documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
        location: { protocol: "https:" },
      };
      new Function("localStorage", "document", "location", privacyNoticeInitScript("2026-10-16"))(g.localStorage, g.document, g.location);
      return { attr: attrs["data-privacy-notice"], cookie: g.document.cookie, stored: store.value };
    };
    expect(run("2026-10-16").attr).toBe("closed");
    expect(run("2026-09-01").attr).toBeUndefined(); // an earlier 시행일: the new notice shows
    expect(run(null).attr).toBeUndefined();
    // the cookie alone is enough (storage cleared or blocked), and storage is refilled
    const byCookie = run(null, `a=1; ${PRIVACY_NOTICE_COOKIE}=2026-10-16`);
    expect(byCookie).toMatchObject({ attr: "closed", stored: "2026-10-16" });
    expect(run(null, `${PRIVACY_NOTICE_COOKIE}=2026-09-01`).attr).toBeUndefined();
    // storage alone: copied into the cookie once
    expect(run("2026-10-16").cookie).toBe(`${PRIVACY_NOTICE_COOKIE}=2026-10-16; path=/; max-age=31536000; samesite=lax; secure`);
    expect(run("2026-10-16", `a=1; ${PRIVACY_NOTICE_COOKIE}=2026-10-16`).cookie).toBe(`a=1; ${PRIVACY_NOTICE_COOKIE}=2026-10-16`);
    expect(run(null, "a=1").cookie).toBe("a=1");
  });

  it("reads one closed state in the browser: storage or cookie, for this 시행일 only", () => {
    expect(cookieValueOf(`a=1; ${PRIVACY_NOTICE_COOKIE}=2026-10-17; b=2`)).toBe("2026-10-17");
    expect(cookieValueOf("a=1")).toBeUndefined();
    expect(cookieValueOf(`x${PRIVACY_NOTICE_COOKIE}=2026-10-17`)).toBeUndefined();
    expect(closedIn({ storage: "2026-10-17", cookie: "" }, "2026-10-17")).toBe(true);
    expect(closedIn({ storage: null, cookie: `${PRIVACY_NOTICE_COOKIE}=2026-10-17` }, "2026-10-17")).toBe(true);
    expect(closedIn({ storage: "2026-10-16", cookie: `${PRIVACY_NOTICE_COOKIE}=2026-10-16` }, "2026-10-17")).toBe(false); // a new revision
  });

  it("a bar already on screen hears of a close in this tab, in another tab, and when a page comes back", () => {
    // a minimal browser: window events, document events, storage and cookie
    const listeners = new Map<string, Set<() => void>>();
    const on = (t: string, f: () => void) => (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(f);
    const off = (t: string, f: () => void) => listeners.get(t)?.delete(f);
    const fire = (t: string) => listeners.get(t)?.forEach((f) => f());
    const storage = new Map<string, string>();
    const attrs: Record<string, string> = {};
    const g = globalThis as unknown as Record<string, unknown>;
    g.window = {
      addEventListener: on,
      removeEventListener: off,
      dispatchEvent: (e: Event) => (fire(e.type), true),
      localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) },
    };
    g.document = { cookie: "", visibilityState: "visible", addEventListener: on, removeEventListener: off, documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
    g.location = { protocol: "https:" };
    try {
      let changes = 0;
      const stop = subscribePrivacyNotice(() => changes++);
      expect(isPrivacyNoticeClosed("2026-10-17")).toBe(false);
      // another tab closes it: a storage event here
      storage.set(PRIVACY_NOTICE_STORAGE_KEY, "2026-10-17");
      fire("storage");
      expect(changes).toBe(1);
      expect(isPrivacyNoticeClosed("2026-10-17")).toBe(true);
      // restored from the back/forward cache, the tab shown again, focus
      fire("pageshow");
      fire("visibilitychange");
      fire("focus");
      expect(changes).toBe(4);
      // closing here: both records at once, and this tab's bars are told
      storage.clear();
      recordPrivacyNoticeClosed("2026-10-17");
      expect(changes).toBe(5);
      expect(storage.get(PRIVACY_NOTICE_STORAGE_KEY)).toBe("2026-10-17");
      expect((g.document as { cookie: string }).cookie).toBe(`${PRIVACY_NOTICE_COOKIE}=2026-10-17; path=/; max-age=31536000; samesite=lax; secure`);
      expect(attrs["data-privacy-notice"]).toBe("closed");
      stop();
      fire("storage");
      expect(changes).toBe(5);
    } finally {
      delete g.window;
      delete g.document;
      delete g.location;
    }
  });

  it("is left out by the server once closed for this 시행일 (cookie), and asks again for the next one", async () => {
    expect(privacyNoticeDismissed("2026-10-16", "2026-10-16")).toBe(true);
    expect(privacyNoticeDismissed("2026-09-01", "2026-10-16")).toBe(false);
    expect(privacyNoticeDismissed(undefined, "2026-10-16")).toBe(false);

    await dismissPrivacyNoticeAction(PRIVACY_POLICY_EFFECTIVE_DATE);
    expect(cookieSet).toHaveBeenCalledWith(PRIVACY_NOTICE_COOKIE, PRIVACY_POLICY_EFFECTIVE_DATE, expect.objectContaining({ path: "/", maxAge: 31536000, sameSite: "lax", httpOnly: false }));
    cookieSet.mockClear();
    await dismissPrivacyNoticeAction("2099-01-01");
    await dismissPrivacyNoticeAction({ evil: true });
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
