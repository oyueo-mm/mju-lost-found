// Phase P-3: notification-side counterpart to
// src/components/layout/chatUnreadEvent.ts -- same plain `window`
// CustomEvent approach (no new state library), kept as its own small file
// since chat and notification unread counts are two independent concerns
// in this app (separate API routes, separate badges), matching this
// codebase's existing convention of not sharing state across domains that
// don't need to.
export const NOTIFICATION_UNREAD_COUNT_EVENT = "mju:notification-unread-count";

export function dispatchNotificationUnreadCount(count: number): void {
  window.dispatchEvent(new CustomEvent<number>(NOTIFICATION_UNREAD_COUNT_EVENT, { detail: count }));
}

export function onNotificationUnreadCount(handler: (count: number) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<number>).detail;
    if (typeof detail === "number") handler(detail);
  };
  window.addEventListener(NOTIFICATION_UNREAD_COUNT_EVENT, listener);
  return () => window.removeEventListener(NOTIFICATION_UNREAD_COUNT_EVENT, listener);
}
