// Phase P-3: a plain `window` CustomEvent, not a new state library --
// per this phase's own constraint ("새로운 전역 상태 라이브러리를 추가하지
// 않는다"). BottomNav/DesktopNav render the chat-unread badge from a
// server-computed prop ((main)/layout.tsx -> Header, see that file's own
// comment), which is correct on a real navigation/full reload but has no
// way to know a room was just marked read by a client-side fetch deep
// inside /chat/[id] (ChatThread.tsx) without either a full page reload or
// a reliable same-URL Server Component refresh -- router.refresh() alone
// was tried first and confirmed, by real browser testing, not to update
// this shared layout's badge until an actual reload. Dispatching the
// server's own fresh count (already computed for the authenticated user,
// see the messages route) directly to these two badge components sidesteps
// that entirely: no guessing at cache behavior, no derived/optimistic math,
// just "here is the real number, straight from the same read that just
// happened".
export const CHAT_UNREAD_COUNT_EVENT = "mju:chat-unread-count";

export function dispatchChatUnreadCount(count: number): void {
  window.dispatchEvent(new CustomEvent<number>(CHAT_UNREAD_COUNT_EVENT, { detail: count }));
}

export function onChatUnreadCount(handler: (count: number) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<number>).detail;
    if (typeof detail === "number") handler(detail);
  };
  window.addEventListener(CHAT_UNREAD_COUNT_EVENT, listener);
  return () => window.removeEventListener(CHAT_UNREAD_COUNT_EVENT, listener);
}
