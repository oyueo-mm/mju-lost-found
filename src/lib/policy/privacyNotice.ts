import { formatEffectiveDate } from "@/lib/auth/terms";
import { LATEST_PRIVACY_POLICY_REVISION, PRIVACY_POLICY_EFFECTIVE_DATE } from "@/lib/policy/privacyPolicy";

// 개인정보처리방침 변경 안내: a policy change announced instead of
// re-consented (auth/terms.ts) is shown as one non-blocking bar above the
// page (components/layout/PrivacyPolicyNotice.tsx) -- before its 시행일 as
// upcoming, then for NOTICE_DAYS after it -- with a link to the policy's
// change history. No account data, no new notice system.
//
// Closed = this browser closed the notice for this 시행일. One rule,
// read the same way everywhere: localStorage OR a cookie holds the 시행일.
//  - the server (layout) reads the cookie and leaves the bar out;
//  - before first paint, privacyNoticeInitScript hides a server-rendered
//    bar (localStorage or cookie) and copies one into the other;
//  - every bar already on screen keeps watching it (privacyNoticeStore):
//    a close in another tab, a page restored from the back/forward cache
//    or a tab coming back hides it at once -- a document rendered before
//    the close never re-checked before, and the app router keeps the
//    layout (and the bar) across in-app navigation.
// Closing writes both at once in the browser, and the server sets the
// same cookie again (a server-set cookie outlives the 7-day cap some
// browsers put on script-written storage). The cookie holds only the
// 시행일, so it is not HttpOnly: the browser side must be able to read it.
// A new 시행일 shows again. A close is per site address.

export const PRIVACY_NOTICE_DAYS = 30;
export const PRIVACY_NOTICE_STORAGE_KEY = "mju-find:privacy-notice";
export const PRIVACY_NOTICE_COOKIE = "mju-find-privacy-notice";
export const PRIVACY_NOTICE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
export const PRIVACY_NOTICE_CHANGE_EVENT = "mju-find:privacy-notice";

// The bar was closed for this 시행일 (the cookie's value).
export const privacyNoticeDismissed = (cookieValue: string | undefined, effective = PRIVACY_POLICY_EFFECTIVE_DATE) => cookieValue === effective;

// The cookie's value in a document.cookie string.
export function cookieValueOf(cookieString: string, name = PRIVACY_NOTICE_COOKIE): string | undefined {
  for (const part of cookieString.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

type BrowserState = { storage: string | null; cookie: string };
// Closed for `id` in this browser: localStorage or cookie.
export const closedIn = (state: BrowserState, id: string) => state.storage === id || cookieValueOf(state.cookie) === id;

export const PRIVACY_NOTICE_HREF = "/policy/privacy#changes";

// What changed: the newest revision's summary (policy §11 shows the same).
export const PRIVACY_NOTICE_SUMMARY = LATEST_PRIVACY_POLICY_REVISION.summary;

export type PrivacyNotice = { id: string; text: string; summary: string; href: string } | null;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// `today`: the KST day. Null once the notice period is over.
export function privacyNotice(today: string, effective = PRIVACY_POLICY_EFFECTIVE_DATE): PrivacyNotice {
  if (today >= addDays(effective, PRIVACY_NOTICE_DAYS)) return null;
  const date = formatEffectiveDate(effective);
  return {
    id: effective,
    text: today < effective ? `개인정보처리방침이 ${date}부터 변경됩니다.` : `개인정보처리방침이 ${date}에 변경되었습니다.`,
    summary: PRIVACY_NOTICE_SUMMARY,
    href: PRIVACY_NOTICE_HREF,
  };
}

// Before first paint: a bar closed for this 시행일 (localStorage or cookie)
// stays hidden (html[data-privacy-notice="closed"], globals.css), and the
// two are brought back in step.
export function privacyNoticeInitScript(effective = PRIVACY_POLICY_EFFECTIVE_DATE): string {
  const key = JSON.stringify(PRIVACY_NOTICE_STORAGE_KEY);
  const id = JSON.stringify(effective);
  const cookie = JSON.stringify(`; ${PRIVACY_NOTICE_COOKIE}=${effective}`);
  const setCookie = JSON.stringify(`${PRIVACY_NOTICE_COOKIE}=${effective}; path=/; max-age=${PRIVACY_NOTICE_COOKIE_MAX_AGE}; samesite=lax`);
  return `(function(){try{var s=null;try{s=localStorage.getItem(${key})}catch(e){}var c=("; "+document.cookie).indexOf(${cookie})>=0;if(s!==${id}&&!c)return;document.documentElement.setAttribute("data-privacy-notice","closed");if(!c)document.cookie=${setCookie}+(location.protocol==="https:"?"; secure":"");if(s!==${id})try{localStorage.setItem(${key},${id})}catch(e){}}catch(e){}})();`;
}

// ---- browser side (components/layout/PrivacyPolicyNotice) ----

function browserState(): BrowserState {
  let storage: string | null = null;
  try {
    storage = window.localStorage.getItem(PRIVACY_NOTICE_STORAGE_KEY);
  } catch {
    // no storage: the cookie alone decides
  }
  return { storage, cookie: document.cookie };
}

export const isPrivacyNoticeClosed = (id: string) => closedIn(browserState(), id);

// Everything that can change the answer while a page is open.
export function subscribePrivacyNotice(onChange: () => void): () => void {
  const onVisible = () => document.visibilityState === "visible" && onChange();
  window.addEventListener("storage", onChange); // another tab closed it
  window.addEventListener(PRIVACY_NOTICE_CHANGE_EVENT, onChange); // this tab
  window.addEventListener("pageshow", onChange); // restored from the back/forward cache
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PRIVACY_NOTICE_CHANGE_EVENT, onChange);
    window.removeEventListener("pageshow", onChange);
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

// Records a close in this browser right away (no server round trip needed).
export function recordPrivacyNoticeClosed(id: string): void {
  document.documentElement.setAttribute("data-privacy-notice", "closed");
  try {
    window.localStorage.setItem(PRIVACY_NOTICE_STORAGE_KEY, id);
  } catch {
    // no storage: the cookie holds it
  }
  document.cookie = `${PRIVACY_NOTICE_COOKIE}=${id}; path=/; max-age=${PRIVACY_NOTICE_COOKIE_MAX_AGE}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
  window.dispatchEvent(new Event(PRIVACY_NOTICE_CHANGE_EVENT));
}
