"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { DESKTOP_ADMIN_NAV_ITEM, DESKTOP_NAV_ITEMS, isNavActive, type DesktopNavKey } from "./NavLinks";
import { DesktopNavDropdown } from "./DesktopNavDropdown";
import { useI18n } from "@/lib/i18n/client";
import { onChatUnreadCount } from "./chatUnreadEvent";

type ServerAction = (formData: FormData) => void | Promise<void>;

// Phase 17: Header's own horizontal nav (md+ only -- BottomNav takes over
// below that breakpoint). Split out from Header itself only because
// usePathname() requires a Client Component, and Header stays a Server
// Component so its user/unread-count data fetch never needs to cross into
// client-bundled code (see Header's own comment, unchanged since before
// notifications existed).
//
// Phase P-3: same live-count mirroring as BottomNav's own -- see that
// component's comment and chatUnreadEvent.ts for why.
export function DesktopNav({
  unreadChatCount,
  isAdmin = false,
  onSignOut,
}: {
  unreadChatCount: number;
  isAdmin?: boolean;
  onSignOut: ServerAction;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [prevUnreadChatCount, setPrevUnreadChatCount] = useState(unreadChatCount);
  const [liveUnreadChatCount, setLiveUnreadChatCount] = useState(unreadChatCount);
  const [openDropdown, setOpenDropdown] = useState<DesktopNavKey | null>(null);
  // "Adjusting state when a prop changes" during render -- see
  // BottomNav.tsx's own (identical) comment for why this isn't a
  // useEffect.
  if (unreadChatCount !== prevUnreadChatCount) {
    setPrevUnreadChatCount(unreadChatCount);
    setLiveUnreadChatCount(unreadChatCount);
  }
  useEffect(() => onChatUnreadCount(setLiveUnreadChatCount), []);
  // Phase 31: appended, never a permanent member of NAV_ITEMS -- see
  // ADMIN_NAV_ITEM's own comment in NavLinks.ts for why.
  const items = isAdmin ? [...DESKTOP_NAV_ITEMS, DESKTOP_ADMIN_NAV_ITEM] : DESKTOP_NAV_ITEMS;

  return (
    <nav aria-label={t("nav.primary")} className="hidden items-center gap-1 md:flex">
      {items.map((item) => {
        const active = isNavActive(item.key, item.href, pathname);
        const badge = item.key === "chat" && liveUnreadChatCount > 0 ? liveUnreadChatCount : null;
        if (item.children) {
          return (
            <DesktopNavDropdown
              key={item.key}
              item={item}
              active={active}
              open={openDropdown === item.key}
              onOpen={() => setOpenDropdown(item.key)}
              onClose={() => setOpenDropdown((current) => (current === item.key ? null : current))}
              onSignOut={onSignOut}
            />
          );
        }
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
              className={`relative flex h-10 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors ${
              active ? "bg-primary-muted text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(item.labelKey)}
            {badge && (
              <span
                aria-label={t("nav.unreadChat", { count: badge })}
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
