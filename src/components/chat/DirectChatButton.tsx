"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { PostType } from "@/lib/posts/schema";

type DirectChatButtonProps = {
  postType: PostType;
  postId: number;
};

// Client-side port of legacy pages/1,2's "💬 작성자와 채팅하기" button --
// no Match required, unlike MatchPanel's "채팅하기" (which only appears
// for a confirmed Match). Only ever rendered for a logged-in, non-owner
// viewer (see /post/[id]/page.tsx) -- POST /api/chat -> getOrCreateDirectChatRoom
// re-checks ownership/suspension itself regardless, this is just the UI
// entry point. Idempotent: clicking it again for the same post just
// re-opens the same room (backed by ChatRoom's own unique constraint),
// never creates a second one.
export function DirectChatButton({ postType, postId }: DirectChatButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postType, postId }),
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

  return (
    <div className="flex flex-col items-start gap-1">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:border-zinc-400 disabled:opacity-60 dark:border-zinc-700 dark:hover:border-zinc-600"
      >
        {pending ? "여는 중..." : "💬 작성자에게 문의하기"}
      </button>
    </div>
  );
}
