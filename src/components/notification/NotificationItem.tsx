"use client";

import { useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";

import { AlertIcon, BellIcon, ChatBubbleIcon, ChatIcon, HandboxIcon, ShieldIcon } from "@/components/icons";

// Phase E-2: one icon per NotificationType's lowercase string (see
// notification/service.ts's own NOTIFICATION_TYPE_FROM_DB/
// NOTIFICATION_TYPE_LABELS, which this keys off the exact same way) --
// reuses this app's existing SVG icon set (Phase 17) instead of raw emoji
// or a new icon. The four report/moderation types collapse onto just two
// icons (Shield for "정지/처리 결과" -- an outcome about your own
// standing, Alert for "삭제/숨김" -- a penalty against a specific piece
// of content) -- typeLabel and title already carry the exact distinction,
// the icon only needs to place it in the right category at a glance.
// BellIcon is the fallback for any type this map doesn't (yet) know
// about, so a future NotificationType never renders with no icon at all --
// "announcement" (Phase M) deliberately relies on exactly that fallback
// rather than adding a dedicated icon just for this.
const TYPE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  message: ChatIcon,
  comment_reply: ChatBubbleIcon,
  match: HandboxIcon,
  report_processed: ShieldIcon,
  user_suspended: ShieldIcon,
  post_deleted: AlertIcon,
  message_hidden: AlertIcon,
};

type NotificationItemProps = {
  id: number;
  type: string; // e.g. "message", "comment_reply" -- see TYPE_ICONS above
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
export function NotificationItem({
  id,
  type,
  title,
  content,
  typeLabel,
  isRead: initialIsRead,
  createdAt,
  href,
}: NotificationItemProps) {
  const router = useRouter();
  const [isRead, setIsRead] = useState(initialIsRead);
  const [pending, setPending] = useState(false);
  // Phase E-2: local-only -- once a DELETE actually succeeds, this item
  // renders nothing (see the early return below). No optimistic removal
  // before the response comes back, so a failed delete never needs a
  // separate "restore" step -- the item just never disappeared.
  const [removed, setRemoved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const Icon = TYPE_ICONS[type] ?? BellIcon;

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

  // Phase E-2: sibling of the click area below, not nested inside it (see
  // this phase's own spec on why -- a <button> can't contain another
  // <button>). stopPropagation is still called defensively even though
  // sibling elements don't bubble into each other's handlers, matching
  // what the spec asked for. router.refresh() (a soft Server Component
  // re-fetch, not a full page reload) keeps the page header's unread
  // count and pagination totals in sync with the row that just
  // disappeared -- same reasoning handleClick's own router.refresh() and
  // MarkAllReadButton's already use.
  async function handleDelete(event: React.MouseEvent) {
    event.stopPropagation();
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/notifications/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setDeleteError(json.error ?? "삭제하지 못했습니다.");
        return;
      }
      setRemoved(true);
      router.refresh();
    } catch {
      setDeleteError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setDeleting(false);
    }
  }

  if (removed) return null;

  return (
    <div className="relative flex w-full flex-col gap-1 rounded-card border border-border bg-card p-4 text-sm transition-colors hover:border-foreground/30">
      <button
        type="button"
        onClick={handleClick}
        className="flex w-full flex-col gap-1 pr-8 text-left disabled:opacity-60"
        disabled={pending}
      >
        <div className="flex items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          {!isRead && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
          <span className={isRead ? "font-normal text-muted-foreground" : "font-semibold text-foreground"}>
            {title}
          </span>
          <span className="text-xs text-muted-foreground">{typeLabel}</span>
        </div>
        <p className="text-muted-foreground">{content}</p>
        <span className="text-xs text-muted-foreground">{createdAt}</span>
      </button>

      {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}

      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        aria-label="알림 삭제"
        className="absolute top-3 right-3 rounded-full px-1.5 py-0.5 text-xs text-muted-foreground hover:text-destructive disabled:opacity-60"
      >
        ×
      </button>
    </div>
  );
}
