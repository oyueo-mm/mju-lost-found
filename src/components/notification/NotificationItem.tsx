"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type NotificationItemProps = {
  id: number;
  title: string;
  content: string;
  typeLabel: string;
  isRead: boolean;
  createdAt: string; // pre-formatted server-side (Intl.DateTimeFormat), see /notifications/page.tsx
  href: string | null; // resolved server-side; null when there's nothing to navigate to
};

// Marks the notification read (idempotent -- see markNotificationAsRead)
// on click, then navigates to `href` if one was resolved. The DB row is
// the only source of truth for isRead; this only re-checks the server's
// response before updating its own local display, never assumes success.
export function NotificationItem({ id, title, content, typeLabel, isRead: initialIsRead, createdAt, href }: NotificationItemProps) {
  const router = useRouter();
  const [isRead, setIsRead] = useState(initialIsRead);
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (pending) return;
    if (!isRead) {
      setPending(true);
      try {
        const res = await fetch(`/api/notifications/${id}`, { method: "PATCH" });
        if (res.ok) {
          setIsRead(true);
          router.refresh();
        }
      } catch {
        // Best-effort: navigation below still proceeds even if marking
        // read failed over the network -- the user isn't blocked from
        // seeing the related resource just because this one call failed.
      } finally {
        setPending(false);
      }
    }
    if (href) router.push(href);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full flex-col gap-1 rounded-card border border-border bg-card p-4 text-left text-sm transition-colors hover:border-foreground/30 disabled:opacity-60"
      disabled={pending}
    >
      <div className="flex items-center gap-2">
        {!isRead && (
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-primary" />
        )}
        <span className={isRead ? "font-normal text-muted-foreground" : "font-semibold text-foreground"}>
          {title}
        </span>
        <span className="text-xs text-muted-foreground">{typeLabel}</span>
      </div>
      <p className="text-muted-foreground">{content}</p>
      <span className="text-xs text-muted-foreground">{createdAt}</span>
    </button>
  );
}
