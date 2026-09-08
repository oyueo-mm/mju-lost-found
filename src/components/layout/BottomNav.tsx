"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ADMIN_NAV_ITEM, NAV_ITEMS, isNavActive } from "./NavLinks";
import { onChatUnreadCount } from "./chatUnreadEvent";
import { HomeIcon, BoxIcon, HandboxIcon, ChatIcon, UserIcon, ShieldIcon } from "@/components/icons";

const ICONS = {
  home: HomeIcon,
  lost: BoxIcon,
  found: HandboxIcon,
  chat: ChatIcon,
  me: UserIcon,
  admin: ShieldIcon,
} as const;

// Phase 17: mobile bottom Navigation (hidden on md+ -- Header's own
// horizontal nav takes over there, see that component). A client
// component only for usePathname()'s active-tab highlighting; the unread
// chat count is computed server-side (Header's own data fetch) and passed
// down as a plain prop -- this never queries anything itself.
//
// Phase P-3: that server prop is only fresh as of the last full
// navigation/reload, so it's mirrored into local state and kept current
// in between by listening for chatUnreadEvent's CustomEvent -- ChatThread
// dispatches the server's own fresh count right after marking a room read.
// See chatUnreadEvent.ts's own comment for why (router.refresh() alone
// wasn't reliable for this same-URL shared-layout case).
export function BottomNav({ unreadChatCount, isAdmin = false }: { unreadChatCount: number; isAdmin?: boolean }) {
  const pathname = usePathname();
  const [prevUnreadChatCount, setPrevUnreadChatCount] = useState(unreadChatCount);
  const [liveUnreadChatCount, setLiveUnreadChatCount] = useState(unreadChatCount);
  // "Adjusting state when a prop changes" during render (not inside an
  // effect -- see https://react.dev/learn/you-might-not-need-an-effect)
  // -- resyncs whenever a real navigation/reload gives this component a
  // new server-computed prop, keeping it as the baseline of truth; the
  // event subscription below only ever nudges it forward in between.
  if (unreadChatCount !== prevUnreadChatCount) {
    setPrevUnreadChatCount(unreadChatCount);
    setLiveUnreadChatCount(unreadChatCount);
  }
  useEffect(() => onChatUnreadCount(setLiveUnreadChatCount), []);
  // Phase 31: appended, never a permanent member of NAV_ITEMS -- see
  // ADMIN_NAV_ITEM's own comment in NavLinks.ts for why.
  const items = isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;

  return (
    <nav
      aria-label="주요 메뉴"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-sm md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-4xl items-stretch justify-between px-1">
        {items.map((item) => {
          const Icon = ICONS[item.key];
          const active = isNavActive(item.key, item.href, pathname);
          const badge = item.key === "chat" && liveUnreadChatCount > 0 ? liveUnreadChatCount : null;
          return (
            <li key={item.key} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="relative">
                  <Icon className="size-6" />
                  {badge && (
                    <span
                      aria-label={`읽지 않은 채팅 ${badge}개`}
                      className="absolute -top-1 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground"
                    >
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
