"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { ReportButton } from "@/components/report/ReportButton";
import { ALLOWED_REACTION_EMOJIS } from "@/lib/chat/schema";

type MessageActionMenuProps = {
  messageId: number;
  // Which side the message bubble sits on (ChatThread aligns "mine"
  // messages right, others left) -- the "⋯" trigger sits on the side
  // away from the screen edge, and the dropdown opens from that same
  // side, so neither ever overflows the chat column.
  align: "start" | "end";
  // The actual message content (image/bubble) -- wrapped, not just
  // adjacent, so a long-press anywhere on the bubble/photo itself opens
  // the menu, matching "메시지 long press" rather than requiring a tap on
  // some separate small trigger.
  children: ReactNode;
  // Phase P-6: plain text for the 복사 action -- "" (an image-only
  // message) hides that button entirely rather than copying nothing.
  content: string;
  // Phase P-6: gates 수정/삭제 -- never shown for another participant's
  // message, so there is no client-side control whose click could even
  // attempt to touch someone else's message (the server re-checks this
  // regardless, see chat/service.ts's editMessage/deleteMessage).
  isMine: boolean;
  // Phase P-6: an already-deleted message has nothing left worth copying/
  // editing/deleting again -- reactions and 답장 stay available, matching
  // this app's existing "hidden masks content, never blocks an action"
  // policy (see chat/service.ts's own comments on that).
  isDeleted: boolean;
  // Phase D-3: fires when 답장 is picked -- ChatThread already has this
  // message's full data loaded (it's rendering it right now), so this
  // menu doesn't need to know anything about the message beyond its id;
  // the parent builds the reply preview itself and closes this menu.
  onReply: () => void;
  // Phase D-4: does the actual PATCH + local-state update -- lives in
  // ChatThread (not here) so the exact same function also backs the
  // reaction badges' own click-to-toggle, instead of two copies of the
  // same fetch. Rejecting shows the error inline in the picker; resolving
  // closes the menu.
  onReact: (emoji: string) => Promise<void>;
  // Phase P-6: switches ChatThread into inline-editing mode for this
  // message -- the actual textarea/저장/취소 UI lives there (it already
  // owns `messages` state), this menu only ever triggers entering it.
  onEdit: () => void;
  // Phase P-6: soft-deletes this message server-side; ChatThread re-syncs
  // its local copy (the masked "삭제된 메시지입니다." content) on success.
  // Rejecting shows the error inline, same convention as onReact.
  onDelete: () => Promise<void>;
};

const LONG_PRESS_MS = 500;

type MenuStep = "menu" | "reacting" | "reporting";

// Suppresses the browser's native text-selection/callout UI only while a
// touch is actively held down on this one message's content -- never a
// blanket `user-select: none` on the whole thread (that would also break
// normal desktop text selection, which this app never touches: these
// styles are only ever applied from touch handlers, and a mouse-driven
// desktop interaction never fires those). Reverts the instant the touch
// ends or turns into a scroll, so nothing stays disabled afterward.
const SUPPRESS_NATIVE_SELECTION_STYLE: CSSProperties = {
  WebkitUserSelect: "none",
  userSelect: "none",
  WebkitTouchCallout: "none",
};

// Phase D-2: replaces the always-visible "신고" link under every message
// with an Instagram-style action menu -- desktop reveals a "⋯" button on
// hover (group-hover, no JS needed for that part), mobile opens it via a
// ~500ms long-press directly on the message content. Both triggers open
// the same menu.
//
// Phase P-6: the emoji picker used to be a separate "step" the menu
// navigated to (한 번 더 탭해야 이모지가 보임) -- now it's shown directly in
// the same view as 답장/복사/수정/삭제/신고, so a long-press or "⋯" tap puts
// every action (including emoji) within one immediate reach, per this
// phase's own "메시지 근처에서 emoji 선택지를 바로 사용" goal. This phase also
// fixes the mobile long-press-selects-text problem (see
// SUPPRESS_NATIVE_SELECTION_STYLE above) and adds 복사/수정/삭제.
export function MessageActionMenu({
  messageId,
  align,
  children,
  content,
  isMine,
  isDeleted,
  onReply,
  onReact,
  onEdit,
  onDelete,
}: MessageActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<MenuStep>("menu");
  const [reacting, setReacting] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState<"복사" | "복사됨" | "복사 실패">("복사");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Distinguishes "this touch ended a long-press that already opened the
  // menu" from "this was just a normal tap/scroll" -- only the former is
  // swallowed, so a plain tap or a scroll starting on a message bubble is
  // never intercepted.
  const longPressFired = useRef(false);
  // Phase P-6: true only while a touch is actively held on the message
  // content -- drives SUPPRESS_NATIVE_SELECTION_STYLE above. Never set by
  // a mouse interaction.
  const [touchActive, setTouchActive] = useState(false);

  function closeMenu() {
    setOpen(false);
    setStep("menu");
    setReactionError(null);
    setDeleteError(null);
    setCopyLabel("복사");
  }

  // Outside click/tap and Escape both close the menu. mousedown/
  // touchstart (not click) is what a scroll gesture also starts with, but
  // that's fine here: a touch that turns into a scroll only reaches this
  // handler once, at its very start, and counts as "outside" only when it
  // didn't begin inside the menu/content wrapper to begin with -- it
  // never fires again mid-scroll.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function startLongPress() {
    longPressFired.current = false;
    setTouchActive(true);
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setOpen(true);
    }, LONG_PRESS_MS);
  }

  // Any finger movement before the timer fires means the touch is a
  // scroll, not a long-press -- cancel so scrolling the thread is never
  // blocked by this.
  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setTouchActive(false);
  }

  function handleTouchEnd(event: React.TouchEvent) {
    cancelLongPress();
    if (longPressFired.current) {
      // Prevents the trailing synthetic click a long-press can still fire
      // on touch-end from immediately re-closing the menu it just opened
      // (the document-level touchstart listener above would otherwise
      // treat that same gesture's touchstart as "outside").
      event.preventDefault();
    }
  }

  async function handlePickEmoji(emoji: string) {
    if (reacting) return;
    setReacting(true);
    setReactionError(null);
    try {
      await onReact(emoji);
      closeMenu();
    } catch (err) {
      setReactionError(err instanceof Error ? err.message : "반응을 남기지 못했습니다.");
    } finally {
      setReacting(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopyLabel("복사됨");
      setTimeout(closeMenu, 700);
    } catch {
      // Most commonly: clipboard permission denied, or a non-secure
      // context without the Clipboard API at all -- either way, this is
      // the only feedback the user needs; nothing else in the app is
      // affected by a failed copy.
      setCopyLabel("복사 실패");
    }
  }

  async function handleDelete() {
    if (deleting) return;
    if (!confirm("메시지를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete();
      closeMenu();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "메시지를 삭제하지 못했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  const canEdit = isMine && !isDeleted && content.length > 0;
  const canDelete = isMine && !isDeleted;
  const canCopy = !isDeleted && content.length > 0;

  return (
    // max-w-[75%] moved here (off the bubble div ChatThread renders as
    // `children`) so it resolves against this row's own definite
    // ancestor width -- a percentage max-width on the bubble itself would
    // instead be resolving against *this* row, which is shrink-to-fit and
    // has no definite width of its own until layout is already done,
    // letting a long message balloon past the intended 75% instead of
    // wrapping. The row's own max-width doesn't have that circularity
    // (flex items clamp to an explicit max-width directly), so capping it
    // here keeps the original 75%-of-thread-width behavior intact.
    <div
      ref={containerRef}
      className={`group relative flex max-w-[75%] items-end gap-1 ${align === "end" ? "flex-row-reverse" : "flex-row"}`}
      onTouchStart={startLongPress}
      onTouchEnd={handleTouchEnd}
      onTouchMove={cancelLongPress}
      onContextMenu={(event) => {
        if (touchActive) event.preventDefault();
      }}
    >
      <div className="flex min-w-0 flex-col" style={touchActive ? SUPPRESS_NATIVE_SELECTION_STYLE : undefined}>
        {children}
      </div>

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="메시지 옵션"
        aria-expanded={open}
        className="mb-1 shrink-0 rounded-full px-1 text-sm text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        ⋯
      </button>

      {open && (
        <div
          className={`absolute top-full z-10 mt-1 flex min-w-40 flex-col gap-0.5 rounded-lg border border-border bg-card p-1 text-sm shadow-md ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {step === "menu" && (
            <>
              {/* Phase P-6: emoji row lives directly in the main menu now
                  (not a separate "reacting" step) -- one tap on "⋯"/long-
                  press already puts every emoji within immediate reach. */}
              <div className="flex items-center gap-0.5 border-b border-border px-1 pt-0.5 pb-1.5">
                {ALLOWED_REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handlePickEmoji(emoji)}
                    disabled={reacting}
                    aria-label={`${emoji} 반응`}
                    className="rounded-full p-1.5 text-lg hover:bg-muted disabled:opacity-60"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              {reactionError && <p className="max-w-40 px-2 py-1 text-xs text-destructive">{reactionError}</p>}

              <button
                type="button"
                onClick={() => {
                  onReply();
                  closeMenu();
                }}
                className="rounded px-2 py-2 text-left text-foreground hover:bg-muted"
              >
                답장
              </button>

              {canCopy && (
                <button type="button" onClick={handleCopy} className="rounded px-2 py-2 text-left text-foreground hover:bg-muted">
                  {copyLabel}
                </button>
              )}

              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    onEdit();
                    closeMenu();
                  }}
                  className="rounded px-2 py-2 text-left text-foreground hover:bg-muted"
                >
                  수정
                </button>
              )}

              {canDelete && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded px-2 py-2 text-left text-destructive hover:bg-destructive-muted disabled:opacity-60"
                >
                  {deleting ? "삭제하는 중..." : "삭제"}
                </button>
              )}
              {deleteError && <p className="max-w-40 px-2 py-1 text-xs text-destructive">{deleteError}</p>}

              <button
                type="button"
                onClick={() => setStep("reporting")}
                className="rounded px-2 py-2 text-left text-destructive hover:bg-destructive-muted"
              >
                신고
              </button>
            </>
          )}

          {step === "reporting" && (
            <ReportButton targetType="message" targetId={messageId} autoOpen onSuccess={closeMenu} />
          )}
        </div>
      )}
    </div>
  );
}
