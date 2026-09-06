// Phase 17: the single source of truth for the app's 5-tab Navigation,
// shared by both Header (desktop top nav) and BottomNav (mobile bottom
// nav) so the two surfaces can never silently drift apart. "관리자" is
// deliberately not a member of this list -- it's an isAdmin-gated entry
// point inside /me, never a 6th main tab (see this phase's own spec).
export type NavKey = "home" | "lost" | "found" | "chat" | "me";

export const NAV_ITEMS: { key: NavKey; href: string; label: string }[] = [
  { key: "home", href: "/", label: "홈" },
  { key: "lost", href: "/lost", label: "분실물" },
  { key: "found", href: "/found", label: "습득물" },
  { key: "chat", href: "/chat", label: "채팅" },
  { key: "me", href: "/me", label: "내 정보" },
];

// "내 정보" is a hub over several pre-existing routes (/posts/mine,
// /matches, /notifications, /admin/*) that live outside /me itself --
// they weren't moved (this phase reorganizes navigation, not URLs), so
// the 내 정보 tab must still highlight while any of them is open.
const ME_ASSOCIATED_PREFIXES = ["/me", "/posts/mine", "/matches", "/notifications", "/admin"];

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
