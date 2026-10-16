import { formatEffectiveDate } from "@/lib/auth/terms";
import { LATEST_PRIVACY_POLICY_REVISION, PRIVACY_POLICY_EFFECTIVE_DATE } from "@/lib/policy/privacyPolicy";

// 개인정보처리방침 변경 안내: a policy change announced instead of
// re-consented (auth/terms.ts) is shown as one non-blocking bar above the
// page (components/layout/PrivacyPolicyNotice.tsx) -- before its 시행일 as
// upcoming, then for NOTICE_DAYS after it -- with a link to the policy's
// change history. Closing it is remembered per 시행일 in this browser, two
// ways: a first-party cookie set by the server (PRIVACY_NOTICE_COOKIE --
// the layout then doesn't render the bar at all, and a server-set cookie
// outlives the 7-day cap some browsers put on script-written storage) and
// localStorage (applied before first paint by privacyNoticeInitScript, so
// a closed bar never flashes; it also copies an earlier close into the
// cookie). The next change shows again. No account data, no new notice
// system. A close is per site address: another of the service's domains
// asks again.

export const PRIVACY_NOTICE_DAYS = 30;
export const PRIVACY_NOTICE_STORAGE_KEY = "mju-find:privacy-notice";
export const PRIVACY_NOTICE_COOKIE = "mju-find-privacy-notice";
export const PRIVACY_NOTICE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

// The bar was closed for this 시행일 (the cookie's value).
export const privacyNoticeDismissed = (cookieValue: string | undefined, effective = PRIVACY_POLICY_EFFECTIVE_DATE) => cookieValue === effective;
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

// Before first paint: a bar closed for this 시행일 stays hidden
// (html[data-privacy-notice="closed"], globals.css).
export function privacyNoticeInitScript(effective = PRIVACY_POLICY_EFFECTIVE_DATE): string {
  const cookie = `${PRIVACY_NOTICE_COOKIE}=${effective}`;
  const setCookie = `${cookie}; path=/; max-age=${PRIVACY_NOTICE_COOKIE_MAX_AGE}; samesite=lax`;
  return `(function(){try{if(localStorage.getItem(${JSON.stringify(PRIVACY_NOTICE_STORAGE_KEY)})===${JSON.stringify(effective)}){document.documentElement.setAttribute("data-privacy-notice","closed");if(("; "+document.cookie).indexOf(${JSON.stringify(`; ${cookie}`)})<0)document.cookie=${JSON.stringify(setCookie)}+(location.protocol==="https:"?"; secure":"");}}catch(e){}})();`;
}
