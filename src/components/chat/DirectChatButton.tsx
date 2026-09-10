"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { PostType } from "@/lib/posts/schema";

type DirectChatButtonProps = {
  postType: PostType;
  postId: number;
  // Phase 12-11 §1/§18: purely a label switch -- the POST body is
  // identical either way ({postType, postId}); getOrCreateDirectChatRoom
  // itself decides server-side whether this is a personal or organization
  // inquiry, based on the post's own organizationId (never trusts this
  // prop for anything but which words to show).
  isOrganizationPost?: boolean;
};

// Client-side port of legacy pages/1,2's "💬 작성자와 채팅하기" button --
// the single way a chat ever starts (Phase J-2 removed the Match-mediated
// alternative). Only ever rendered for a logged-in, non-owner
// viewer (see /post/[id]/page.tsx) -- POST /api/chat -> getOrCreateDirectChatRoom
// re-checks ownership/suspension itself regardless, this is just the UI
// entry point. Idempotent: clicking it again for the same post just
// re-opens the same room (backed by ChatRoom's own unique constraint),
// never creates a second one.
//
// Phase 12-11 §1: on an organization-attributed post, this renders as
// "단체에 문의하기" instead of "채팅하기" -- the underlying request is
// unchanged, only the label communicates that the counterpart is the
// organization, not the post's own (hidden) real author.
export function DirectChatButton({ postType, postId, isOrganizationPost = false }: DirectChatButtonProps) {
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
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:border-foreground/30 disabled:opacity-60"
      >
        {pending ? "여는 중..." : isOrganizationPost ? "단체에 문의하기" : "채팅하기"}
      </button>
    </div>
  );
}
