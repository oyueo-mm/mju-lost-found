"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { dispatchNotificationUnreadCount } from "@/components/notification/notificationUnreadEvent";
import { useI18n } from "@/lib/i18n/client";

export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? t("notification.markAllFailed"));
        return;
      }
      // Phase P-3: pushes the header bell badge to 0 immediately -- same
      // fresh-count-push fix as NotificationItem.tsx's own handleClick/
      // handleDelete (router.refresh() below still keeps this page's own
      // heading/list in sync, but doesn't reliably reach the shared
      // layout's badge on its own -- see that file's comment).
      if (typeof json?.unreadNotificationCount === "number") {
        dispatchNotificationUnreadCount(json.unreadNotificationCount);
      }
      router.refresh();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || pending}
        className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:border-foreground/30 disabled:opacity-60"
      >
        {pending ? t("notification.processing") : t("notification.markAllRead")}
      </button>
    </div>
  );
}
