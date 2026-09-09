"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { ReportButton } from "@/components/report/ReportButton";

type CommentActionMenuProps = {
  commentId: number;
  // The comment's own visible body (author line + content) -- wrapped,
  // not just adjacent, so a long-press anywhere on it opens the menu,
  // matching chat/MessageActionMenu's "long press on the bubble itself"
  // pattern (see that component for the reasoning this mirrors).
  children: ReactNode;
  // Phase 7: mirrors MessageActionMenu's isMine-style gating -- never
  // shown for a comment this requester doesn't own/administer, and the
  // server re-checks all of this regardless (comment/service.ts's
  // updateComment/deleteComment).
  canEdit: boolean;
  canDelete: boolean;
  // False for the requester's own comment (no self-report UI) and for a
  // logged-out visitor (ReportButton requires a session anyway).
  canReport: boolean;
  onEdit: () => void;
  // Does the actual DELETE + local-state update; lives in CommentSection
  // (which already owns `comments` state), same division of labor as
  // MessageActionMenu's onDelete living in ChatThread.
  onDelete: () => Promise<void>;
};

const LONG_PRESS_MS = 500;

type MenuStep = "menu" | "reporting";

// Same touch-only, no-blanket-user-select-none technique as
// chat/MessageActionMenu.tsx's own SUPPRESS_NATIVE_SELECTION_STYLE --
// applied only while a touch is actively held on this one comment's body,
// never globally, so normal desktop text selection is untouched.
const SUPPRESS_NATIVE_SELECTION_STYLE: CSSProperties = {
  WebkitUserSelect: "none",
  userSelect: "none",
  WebkitTouchCallout: "none",
};

// Phase 7: replaces CommentSection's always-visible 수정/삭제/신고 text
// links with the same "⋯"-menu / mobile-long-press pattern P-6 introduced
// for chat messages (chat/MessageActionMenu.tsx) -- 답글 stays a separate,
// always-visible button in CommentSection since every logged-in user can
// reply regardless of ownership, matching this phase's own mockup (only
// 수정/삭제/신고 live under "⋯").
export function CommentActionMenu({
  commentId,
  children,
  canEdit,
  canDelete,
  canReport,
  onEdit,
  onDelete,
}: CommentActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<MenuStep>("menu");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const [touchActive, setTouchActive] = useState(false);

  const hasAnyAction = canEdit || canDelete || canReport;

  function closeMenu() {
    setOpen(false);
    setStep("menu");
    setDeleteError(null);
  }

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
    if (!hasAnyAction) return;
    longPressFired.current = false;
    setTouchActive(true);
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setOpen(true);
    }, LONG_PRESS_MS);
  }

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
      event.preventDefault();
    }
  }

  async function handleDelete() {
    if (deleting) return;
    if (!confirm("댓글을 삭제하시겠습니까? 이 댓글에 달린 답글도 함께 삭제됩니다.")) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete();
      closeMenu();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "댓글을 삭제하지 못했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative flex items-start gap-1"
      onTouchStart={startLongPress}
      onTouchEnd={handleTouchEnd}
      onTouchMove={cancelLongPress}
      onContextMenu={(event) => {
        if (touchActive) event.preventDefault();
      }}
    >
      <div className="min-w-0 flex-1" style={touchActive ? SUPPRESS_NATIVE_SELECTION_STYLE : undefined}>
        {children}
      </div>

      {hasAnyAction && (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-label="댓글 옵션"
          aria-expanded={open}
          className="shrink-0 rounded-full px-1 text-sm text-muted-foreground hover:text-foreground"
        >
          ⋯
        </button>
      )}

      {open && (
        <div className="absolute top-full right-0 z-10 mt-1 flex min-w-40 flex-col gap-0.5 rounded-lg border border-border bg-card p-1 text-sm shadow-md">
          {step === "menu" && (
            <>
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

              {canReport && (
                <button
                  type="button"
                  onClick={() => setStep("reporting")}
                  className="rounded px-2 py-2 text-left text-destructive hover:bg-destructive-muted"
                >
                  신고
                </button>
              )}
            </>
          )}

          {step === "reporting" && (
            <ReportButton targetType="comment" targetId={commentId} autoOpen onSuccess={closeMenu} />
          )}
        </div>
      )}
    </div>
  );
}
