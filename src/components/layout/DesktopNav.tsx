"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ADMIN_NAV_ITEM, NAV_ITEMS, isNavActive } from "./NavLinks";

// Phase 17: Header's own horizontal nav (md+ only -- BottomNav takes over
// below that breakpoint). Split out from Header itself only because
// usePathname() requires a Client Component, and Header stays a Server
// Component so its user/unread-count data fetch never needs to cross into
// client-bundled code (see Header's own comment, unchanged since before
// notifications existed).
export function DesktopNav({ unreadChatCount, isAdmin = false }: { unreadChatCount: number; isAdmin?: boolean }) {
  const pathname = usePathname();
  // Phase 31: appended, never a permanent member of NAV_ITEMS -- see
  // ADMIN_NAV_ITEM's own comment in NavLinks.ts for why.
  const items = isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;

  return (
    <nav aria-label="주요 메뉴" className="hidden items-center gap-1 md:flex">
      {items.map((item) => {
        const active = isNavActive(item.key, item.href, pathname);
        const badge = item.key === "chat" && unreadChatCount > 0 ? unreadChatCount : null;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`relative rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              active ? "bg-primary-muted text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
            {badge && (
              <span
                aria-label={`읽지 않은 채팅 ${badge}개`}
                className="absolute -top-1 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground"
              >
                {badge > 9 ? "9+" : badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
