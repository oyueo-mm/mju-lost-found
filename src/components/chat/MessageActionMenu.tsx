"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

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
};

const LONG_PRESS_MS = 500;

type MenuStep = "menu" | "reacting" | "reporting";

// Phase D-2: replaces the always-visible "신고" link under every message
// with an Instagram-style action menu -- desktop reveals a "⋯" button on
// hover (group-hover, no JS needed for that part), mobile opens it via a
// ~500ms long-press directly on the message content. Both triggers open
// the same menu. Phase D-3 wired up 답장; Phase D-4 wires up 이모티콘
// (an emoji picker, PATCHing the same /api/chat/[id]/messages route
// GET/POST already live on -- no new API route).
export function MessageActionMenu({ messageId, align, children, onReply, onReact }: MessageActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<MenuStep>("menu");
  const [reacting, setReacting] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Distinguishes "this touch ended a long-press that already opened the
  // menu" from "this was just a normal tap/scroll" -- only the former is
  // swallowed, so a plain tap or a scroll starting on a message bubble is
  // never intercepted.
  const longPressFired = useRef(false);

  function closeMenu() {
    setOpen(false);
    setStep("menu");
    setReactionError(null);
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
    >
      <div className="flex min-w-0 flex-col">{children}</div>

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
          className={`absolute top-full z-10 mt-1 flex min-w-32 flex-col gap-0.5 rounded-lg border border-border bg-card p-1 text-sm shadow-md ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {step === "menu" && (
            <>
              <button
                type="button"
                onClick={() => setStep("reacting")}
                className="rounded px-2 py-1.5 text-left text-foreground hover:bg-muted"
              >
                😊 이모티콘
              </button>
              <button
                type="button"
                onClick={() => {
                  onReply();
                  closeMenu();
                }}
                className="rounded px-2 py-1.5 text-left text-foreground hover:bg-muted"
              >
                답장
              </button>
              <button
                type="button"
                onClick={() => setStep("reporting")}
                className="rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive-muted"
              >
                신고
              </button>
            </>
          )}

          {step === "reacting" && (
            <div className="flex flex-col gap-1 p-1">
              {reactionError && <p className="max-w-40 text-xs text-destructive">{reactionError}</p>}
              <div className="flex gap-1">
                {ALLOWED_REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handlePickEmoji(emoji)}
                    disabled={reacting}
                    aria-label={`${emoji} 반응`}
                    className="rounded-full p-1 text-lg hover:bg-muted disabled:opacity-60"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "reporting" && (
            <ReportButton targetType="message" targetId={messageId} autoOpen onSuccess={closeMenu} />
          )}
        </div>
      )}
    </div>
  );
}
