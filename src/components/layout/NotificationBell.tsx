"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { onNotificationUnreadCount } from "@/components/notification/notificationUnreadEvent";
import { BellIcon } from "@/components/icons";

// Phase P-3: split out of Header.tsx (previously inline, server-rendered
// only) so the badge can be nudged forward between navigations -- same
// "server prop as baseline, CustomEvent as the live update" pattern
// BottomNav.tsx/DesktopNav.tsx already use for the chat badge, see those
// components' own comments and notificationUnreadEvent.ts for why
// router.refresh() alone (NotificationItem.tsx's/MarkAllReadButton.tsx's
// original approach) wasn't a reliable signal for this same-URL shared-
// layout update. Header itself stays a Server Component -- only this one
// small badge needs to be a Client Component now, not the whole header.
export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  const [prevUnreadCount, setPrevUnreadCount] = useState(unreadCount);
  const [liveUnreadCount, setLiveUnreadCount] = useState(unreadCount);
  // "Adjusting state when a prop changes" during render, not inside an
  // effect -- see BottomNav.tsx's own (identical) comment for why.
  if (unreadCount !== prevUnreadCount) {
    setPrevUnreadCount(unreadCount);
    setLiveUnreadCount(unreadCount);
  }
  useEffect(() => onNotificationUnreadCount(setLiveUnreadCount), []);

  return (
    <Link
      href="/notifications"
      aria-label={`알림${liveUnreadCount > 0 ? ` (읽지 않음 ${liveUnreadCount}개)` : ""}`}
      className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <BellIcon className="size-5" />
      {liveUnreadCount > 0 && (
        <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
          {liveUnreadCount > 9 ? "9+" : liveUnreadCount}
        </span>
      )}
    </Link>
  );
}
