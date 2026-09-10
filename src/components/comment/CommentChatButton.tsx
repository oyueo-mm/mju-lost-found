"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { PostType } from "@/lib/posts/schema";

type CommentChatButtonProps = {
  postType: PostType;
  postId: number;
  commentId: number;
};

// Phase 12-9 §3/§4: same POST /api/chat -> getOrCreateDirectChatRoom flow
// DirectChatButton.tsx already uses for "게시글 작성자와 채팅하기", just with
// commentId added so the room's counterpart is that *comment's* actual
// author (authorUserId) -- never the organization a comment is attributed
// to (§4's own requirement: attribution is a display label only, the real
// chat recipient is always the real author). Only ever rendered for a
// logged-in viewer who isn't the comment's own author (see
// CommentSection's own gating) -- the server re-derives and re-validates
// the comment's real author regardless (never trusts anything the client
// claims), this is just the UI entry point. Idempotent: clicking it again
// for the same comment just re-opens the same room.
export function CommentChatButton({ postType, postId, commentId }: CommentChatButtonProps) {
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
        body: JSON.stringify({ postType, postId, commentId }),
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
    <span className="inline-flex items-center gap-1">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="text-muted-foreground underline hover:text-foreground disabled:opacity-60"
      >
        {pending ? "여는 중..." : "채팅하기"}
      </button>
    </span>
  );
}
