// Phase 17: the single source of truth for the app's 5-tab Navigation,
// shared by both Header (desktop top nav) and BottomNav (mobile bottom
// nav) so the two surfaces can never silently drift apart.
//
// Phase 31: "관리자" is now a 6th tab (ADMIN_NAV_ITEM below), reversing
// Phase 17's original choice to keep it out of the main Navigation --
// this phase's own spec asks for it explicitly. It's kept out of
// NAV_ITEMS itself (rather than added as a 6th, always-present entry)
// since it must only ever render for an admin user; Header/DesktopNav/
// BottomNav each append it conditionally instead.
import type { TranslationKey } from "@/lib/i18n/translate";

export type NavKey = "home" | "lost" | "found" | "chat" | "me" | "admin";

// 다국어(i18n) Phase: 라벨을 하드코딩된 한국어 문자열 대신 번역 키로
// 둔다 -- 탭의 개수/순서/href/활성화 규칙(isNavActive)은 전혀 바뀌지
// 않았다. 실제 문구는 Header(DesktopNav)와 BottomNav가 각각 t()로
// 읽는다.
export const NAV_ITEMS: { key: NavKey; href: string; labelKey: TranslationKey }[] = [
  { key: "home", href: "/", labelKey: "nav.home" },
  { key: "lost", href: "/lost", labelKey: "nav.lost" },
  { key: "found", href: "/found", labelKey: "nav.found" },
  { key: "chat", href: "/chat", labelKey: "nav.chat" },
  { key: "me", href: "/me", labelKey: "nav.me" },
];

export const ADMIN_NAV_ITEM: { key: NavKey; href: string; labelKey: TranslationKey } = {
  key: "admin",
  href: "/admin",
  labelKey: "nav.admin",
};

// "내 정보" is a hub over several pre-existing routes (/posts/mine,
// /notifications) that live outside /me itself -- they weren't moved
// (this phase reorganizes navigation, not URLs), so the 내 정보 탭 must
// still highlight while any of them is open. ("/matches" was in this list
// until Phase J-2 removed the Match domain along with that route.)
// "/admin" is deliberately NOT in this list any more (Phase 31): it has
// its own tab now (ADMIN_NAV_ITEM), and isNavActive's generic prefix-match
// branch below already highlights that tab correctly -- leaving "/admin"
// here too would highlight both tabs at once.
const ME_ASSOCIATED_PREFIXES = ["/me", "/posts/mine", "/notifications"];

// A tab is "active" for its own path and anything nested under it (e.g.
// /lost/new highlights 분실물) -- except "홈", which only matches the
// exact root (every other tab's href is also a prefix of "/", so the
// naive prefix check would make 홈 permanently active otherwise). A post
// detail page (/post/[id]) lives outside both /lost and /found, so it
// intentionally highlights neither tab -- there's no reliable way to know
// which board a viewer arrived from without threading extra state through
// every link into it.
export function isNavActive(key: NavKey, href: string, pathname: string): boolean {
  if (key === "home") return pathname === "/";
  if (key === "me") {
    return ME_ASSOCIATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
