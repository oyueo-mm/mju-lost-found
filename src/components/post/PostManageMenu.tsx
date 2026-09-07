"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { PostType } from "@/lib/posts/schema";
import { MoreIcon } from "@/components/icons";

type PostManageMenuProps = {
  id: number;
  type: PostType;
  currentStatus: string;
  // The two possible values for this post's board, in order (e.g.
  // ["찾는 중", "찾음"]) -- same shape StatusChangeControl already took,
  // passed in by the page rather than imported here.
  statuses: readonly [string, string];
};

// Phase H-6: consolidates what used to be three separate always-visible
// controls (수정 link, StatusChangeControl's button, DeletePostButton) into
// one "⋯" trigger -- same underlying API calls (PATCH/DELETE
// /api/posts/[id]), same confirm() gate before delete, same forward-only
// status transition, same ownership gate (this component is only ever
// rendered by /post/[id]/page.tsx when isOwner is true; a non-owner never
// even receives this component in their render tree, and the API itself
// re-checks ownership regardless of what the UI shows or hides -- this is
// UI-only consolidation, no permission logic changed or duplicated here).
export function PostManageMenu({ id, type, currentStatus, statuses }: PostManageMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<"status" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [initial, final] = statuses;
  const isFinal = currentStatus === final;

  // No dropdown/popover library in this project (see icons.tsx's own
  // "no new dependency" convention) -- a plain outside-click listener is
  // the whole mechanism for closing the menu when you click away from it.
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleStatusChange() {
    if (pending !== null) return;
    setPending("status");
    setError(null);
    try {
      const res = await fetch(`/api/posts/${id}?type=${type}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: final }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "상태를 변경하지 못했습니다.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setPending(null);
    }
  }

  async function handleDelete() {
    if (pending !== null) return;
    if (!confirm("정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) return;

    setPending("delete");
    setError(null);
    try {
      const res = await fetch(`/api/posts/${id}?type=${type}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "삭제하지 못했습니다.");
        setPending(null);
        return;
      }
      router.push(type === "lost" ? "/lost" : "/found");
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
      setPending(null);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="게시글 관리 메뉴"
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreIcon className="size-5" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-1 w-52 overflow-hidden rounded-card border border-border bg-card py-1 shadow-lg"
        >
          <Link
            href={`/post/${id}/edit?type=${type}`}
            role="menuitem"
            className="block px-4 py-2.5 text-sm text-foreground hover:bg-muted"
            onClick={() => setOpen(false)}
          >
            수정
          </Link>
          {!isFinal && (
            <button
              type="button"
              role="menuitem"
              onClick={handleStatusChange}
              disabled={pending !== null}
              className="block w-full px-4 py-2.5 text-left text-sm text-foreground hover:bg-muted disabled:opacity-60"
            >
              {pending === "status" ? "변경 중..." : `'${final}'(으)로 상태 변경`}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={handleDelete}
            disabled={pending !== null}
            className="block w-full px-4 py-2.5 text-left text-sm text-destructive hover:bg-destructive-muted disabled:opacity-60"
          >
            {pending === "delete" ? "삭제 중..." : "삭제"}
          </button>
        </div>
      )}

      {error && (
        <p className="absolute right-0 top-full z-10 mt-1 w-56 rounded-card border border-destructive/30 bg-destructive-muted px-3 py-2 text-xs text-destructive shadow-lg">
          {error}
        </p>
      )}

      {/* isFinal-only informational line -- StatusChangeControl used to
          show this in place of its (now absent) button; kept here as
          plain text under the trigger only in the rare final-state
          all-actions-done case, not inside the menu itself. */}
      {isFinal && open === false && (
        <span className="sr-only">현재 상태: {initial === final ? initial : final}</span>
      )}
    </div>
  );
}
