"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { PostType } from "@/lib/posts/schema";

type StatusChangeControlProps = {
  id: number;
  type: PostType;
  currentStatus: string;
  // The two possible values for this post's board, in order (e.g.
  // ["찾는 중", "찾음"]) -- passed in by the page rather than imported
  // here, so this component never has to know which board it's on beyond
  // what it's told (see /post/[id]/page.tsx, which already has
  // LOST_STATUSES/FOUND_STATUSES available).
  statuses: readonly [string, string];
};

// Client-side port of legacy pages/3_내_게시물.py's status-change button:
// a single "다음 상태로 변경" action (never a free-form select -- both
// boards only ever have two states, and the only meaningful transition is
// forward, exactly like legacy's single button). Only ever rendered for
// the post's owner (see /post/[id]/page.tsx) -- PATCH /api/posts/[id]
// re-checks ownership itself regardless, this is just the UI entry point.
export function StatusChangeControl({ id, type, currentStatus, statuses }: StatusChangeControlProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [initial, final] = statuses;
  const isFinal = currentStatus === final;
  const nextStatus = final; // the only forward transition either board has

  async function handleChange() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${id}?type=${type}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "상태를 변경하지 못했습니다.");
        setPending(false);
        return;
      }
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
      setPending(false);
    }
  }

  if (isFinal) {
    return <p className="text-sm text-zinc-400 dark:text-zinc-500">이미 &apos;{final}&apos; 상태입니다.</p>;
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        onClick={handleChange}
        disabled={pending}
        className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:border-zinc-400 disabled:opacity-60 dark:border-zinc-700 dark:hover:border-zinc-600"
      >
        {pending ? "변경 중..." : `'${final}'(으)로 상태 변경`}
      </button>
      <p className="text-xs text-zinc-400 dark:text-zinc-500">현재 상태: {initial}</p>
    </div>
  );
}
