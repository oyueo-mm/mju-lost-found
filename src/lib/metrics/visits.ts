// 방문 통계 (운영 통계): what a page view is reduced to before it reaches the
// server -- a page kind, and on the first view of a visit session a referrer
// category and sanitized UTM tags. Shared by the browser beacon
// (components/layout/VisitBeacon) and the server action that counts it
// (app/visitActions.ts). No URL, path id, query, IP or identifier is kept:
// only fixed labels, counted per KST day in MetricDaily.

export const PAGE_KINDS = [
  "home",
  "lost",
  "found",
  "search",
  "post",
  "write",
  "chat",
  "notifications",
  "me",
  "organizations",
  "profile",
  "policy",
  "login",
  "onboarding",
  "other",
] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export const PAGE_KIND_LABELS: Record<PageKind, string> = {
  home: "홈",
  lost: "분실물 게시판",
  found: "습득물 게시판",
  search: "검색",
  post: "게시글 상세",
  write: "게시글 등록",
  chat: "채팅",
  notifications: "알림",
  me: "내 정보",
  organizations: "단체",
  profile: "공개 프로필",
  policy: "약관·정책",
  login: "로그인",
  onboarding: "가입·동의",
  other: "기타",
};

export function isPageKind(value: unknown): value is PageKind {
  return typeof value === "string" && (PAGE_KINDS as readonly string[]).includes(value);
}

// null = not counted (admin pages are internal tools, not visits).
export function pageKindOf(pathname: string): PageKind | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") return "home";
  if (p === "/admin" || p.startsWith("/admin/")) return null;
  if (p === "/lost/new" || p === "/found/new" || /^\/post\/[^/]+\/edit$/.test(p)) return "write";
  if (p === "/lost") return "lost";
  if (p === "/found") return "found";
  if (p === "/search") return "search";
  if (p.startsWith("/post/")) return "post";
  if (p === "/chat" || p.startsWith("/chat/")) return "chat";
  if (p === "/notifications") return "notifications";
  if (p === "/me" || p.startsWith("/me/") || p === "/posts/mine") return "me";
  if (p === "/organizations" || p.startsWith("/organizations/")) return "organizations";
  if (p.startsWith("/profile/")) return "profile";
  if (p.startsWith("/policy/")) return "policy";
  if (p === "/login") return "login";
  if (["/onboarding", "/privacy-consent", "/account-guide", "/rejoin", "/suspended"].includes(p)) return "onboarding";
  return "other";
}

// Where a visit session came from -- a fixed category, never the URL.
export const REF_SOURCES = [
  "direct",
  "internal",
  "everytime",
  "mju",
  "google",
  "naver",
  "daum",
  "kakao",
  "instagram",
  "facebook",
  "x",
  "youtube",
  "bing",
  "other",
] as const;
export type RefSource = (typeof REF_SOURCES)[number];

export const REF_SOURCE_LABELS: Record<RefSource, string> = {
  // no referrer is not proof of a direct visit (in-app browsers, privacy settings)
  direct: "리퍼러 없음(직접 방문·앱 안 브라우저 등)",
  internal: "사이트 내부(재방문)",
  everytime: "에브리타임",
  mju: "명지대 사이트",
  google: "구글",
  naver: "네이버",
  daum: "다음",
  kakao: "카카오",
  instagram: "인스타그램",
  facebook: "페이스북",
  x: "X(트위터)",
  youtube: "유튜브",
  bing: "빙",
  other: "기타 사이트",
};

export function isRefSource(value: unknown): value is RefSource {
  return typeof value === "string" && (REF_SOURCES as readonly string[]).includes(value);
}

const hostIs = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

// `referrer` is document.referrer; `ownHost` is location.host.
export function refSourceOf(referrer: string, ownHost: string): RefSource {
  if (!referrer) return "direct";
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (host === ownHost.split(":")[0].toLowerCase()) return "internal";
  if (hostIs(host, "everytime.kr")) return "everytime";
  if (hostIs(host, "mju.ac.kr")) return "mju";
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return "google";
  if (hostIs(host, "naver.com") || hostIs(host, "naver.me")) return "naver";
  if (hostIs(host, "daum.net")) return "daum";
  if (hostIs(host, "kakao.com") || hostIs(host, "kakaocdn.net")) return "kakao";
  if (hostIs(host, "instagram.com")) return "instagram";
  if (hostIs(host, "facebook.com") || hostIs(host, "fb.com")) return "facebook";
  if (hostIs(host, "t.co") || hostIs(host, "x.com") || hostIs(host, "twitter.com")) return "x";
  if (hostIs(host, "youtube.com") || hostIs(host, "youtu.be")) return "youtube";
  if (hostIs(host, "bing.com")) return "bing";
  return "other";
}

// UTM values are visitor-controlled: lower-case letters, digits, "-" and
// "_" only, at most 32 characters; anything else -> null (not counted). So
// no URL, e-mail or free text can be stored, and 7+ digits in a row once "-"/"_" are taken out (a
// phone, student or full-date number pasted into a link) is refused too.
export function sanitizeUtm(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(v) && !/\d{7,}/.test(v.replace(/[-_]/g, "")) ? v : null;
}

// ---------- 유입 경로 (inflow) ----------
// A visit session's source, decided once at its first view: a valid
// utm_source wins over the referrer (a campaign link says where it was
// posted), and the two stay apart in the counter name so either can be
// read on its own: "utm.<value>" or "ref.<category>".
export type ChannelKey = `utm.${string}` | `ref.${RefSource}`;
export function channelOf(ref: RefSource, utmSource: string | null): ChannelKey {
  return utmSource ? `utm.${utmSource}` : `ref.${ref}`;
}

// Where a channel points to, for grouping: a known site (UTM spellings
// people actually use are folded in), offline QR / posters, a UTM value of
// its own, or "unknown" -- no referrer is not proof of a direct visit
// (typed address, bookmark, but also in-app browsers and privacy settings
// that drop the referrer).
const UTM_SITES: Record<string, RefSource | "qr"> = {
  everytime: "everytime",
  et: "everytime",
  instagram: "instagram",
  insta: "instagram",
  ig: "instagram",
  kakao: "kakao",
  kakaotalk: "kakao",
  google: "google",
  naver: "naver",
  daum: "daum",
  facebook: "facebook",
  fb: "facebook",
  youtube: "youtube",
  x: "x",
  twitter: "x",
  mju: "mju",
  qr: "qr",
  poster: "qr",
  poster_qr: "qr",
  "poster-qr": "qr",
};
export type SiteKey = RefSource | "qr" | "unknown" | `utm:${string}`;
export function siteOf(channel: string): SiteKey {
  if (channel.startsWith("utm.")) {
    const v = channel.slice(4);
    return UTM_SITES[v] ?? `utm:${v}`;
  }
  const ref = channel.slice(4);
  if (ref === "direct") return "unknown";
  return isRefSource(ref) ? ref : "other";
}
export function siteLabel(site: SiteKey): string {
  if (site === "unknown") return "출처 확인 불가 (리퍼러 없음)";
  if (site === "qr") return "포스터·QR (UTM)";
  if (site.startsWith("utm:")) return `기타 UTM: ${site.slice(4)}`;
  return REF_SOURCE_LABELS[site as RefSource] ?? site;
}

// Crawlers and headless tools (a second line after the browser's own
// navigator.webdriver check).
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|pagespeed|python-requests|curl|wget|httpclient/i.test(
    userAgent,
  );
}

export type VisitEvent = {
  kind: PageKind;
  sessionStart: boolean;
  ref?: RefSource;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
};

// Visit session: 30 minutes without a page view, or a new KST day, starts a
// new one (a common web-analytics convention). A session is not a person:
// one person on two devices, or after clearing site data, is two sessions.
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const MAX_EVENTS_PER_CALL = 20;

// ---------- 접속 기기 ----------
// Device class of a visit, decided on the server from the request's
// User-Agent and the Sec-CH-UA-Mobile client hint, plus one flag from the
// browser (does it have a touch screen). Only the class is counted; the
// User-Agent itself is never stored.
//
// Limits, kept honest rather than guessed:
// - iPadOS Safari sends a Mac desktop User-Agent. A Mac has no touch
//   screen, so "Mac + touch" is counted as a tablet; without the flag
//   (old beacon, no JS detail) it would read as a PC.
// - A Windows touch laptop / Surface, or a phone using "desktop site"
//   mode, cannot be told apart from a PC and is counted as one.
// - Android tablets are the Android devices whose User-Agent lacks
//   "Mobile" (the convention Android browsers follow).
// - TVs, consoles, unknown or missing User-Agents: 기타·미확인.
export const DEVICE_KINDS = ["mobile", "pc", "tablet", "other"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
export const DEVICE_LABELS: Record<DeviceKind, string> = {
  mobile: "모바일(스마트폰)",
  pc: "PC",
  tablet: "태블릿",
  other: "기타·미확인",
};

export function deviceOf(userAgent: string | null | undefined, clientHintMobile?: string | null, touch?: boolean): DeviceKind {
  const ua = userAgent ?? "";
  if (!ua.trim()) return "other";
  if (/SmartTV|SMART-TV|HbbTV|Tizen.*TV|Web0S|NetCast|CrKey|AppleTV|PlayStation|Xbox|Nintendo/i.test(ua)) return "other";
  if (/iPad/.test(ua)) return "tablet";
  if (/iPhone|iPod/.test(ua)) return "mobile";
  if (/Android/i.test(ua)) return /Mobile/.test(ua) ? "mobile" : "tablet";
  if (clientHintMobile === "?1") return "mobile";
  if (/Windows Phone|IEMobile|BlackBerry|BB10|KAIOS|Opera Mini/i.test(ua)) return "mobile";
  if (/Macintosh|Mac OS X/.test(ua)) return touch === true ? "tablet" : "pc";
  if (/Windows NT|CrOS|X11|Linux x86_64|Linux i686/.test(ua)) return "pc";
  return "other";
}
