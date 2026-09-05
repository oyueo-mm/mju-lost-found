"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type MyMatchActionsProps = {
  matchId: number;
};

// Client-side port of MatchPanel's "채팅하기"/"매칭 해제" buttons, reused
// here verbatim at the API level (same POST /api/chat { matchId } /
// DELETE /api/matches/[id] endpoints, same idempotent get-or-create
// semantics) -- just presented per-row on the /matches summary page
// instead of inline on a single post's detail page. Not a shared
// component with MatchPanel itself: that one also renders AI candidates
// and a "매칭된 게시물" list scoped to one post, which doesn't fit this
// page's cross-post summary shape, so duplicating this one small action
// pair was more honest than forcing a shared abstraction across two
// differently-shaped UIs.
export function MyMatchActions({ matchId }: MyMatchActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  async function handleOpenChat() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "채팅방을 여는 데 실패했습니다.");
        setPending(false);
        return;
      }
      router.push(`/chat/${json.data.id}`);
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
      setPending(false);
    }
  }

  async function handleCancel() {
    if (pending) return;
    if (!confirm("정말 매칭을 취소하시겠습니까?")) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/matches/${matchId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "매칭을 취소하지 못했습니다.");
        setPending(false);
        return;
      }
      setCancelled(true);
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
      setPending(false);
    }
  }

  if (cancelled) {
    return <p className="text-sm text-zinc-400 dark:text-zinc-500">매칭이 취소되었습니다.</p>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleOpenChat}
          disabled={pending}
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:border-zinc-400 disabled:opacity-60 dark:border-zinc-700 dark:hover:border-zinc-600"
        >
          {pending ? "처리 중..." : "채팅하기"}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={pending}
          className="text-sm text-red-600 underline disabled:opacity-60 dark:text-red-400"
        >
          매칭 취소
        </button>
      </div>
    </div>
  );
}
