"use client";

import { useTransition } from "react";
import { openDirectChat } from "@/lib/chat-actions";

export default function OpenChatButton({ postKind, postId, label = "채팅하기" }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => openDirectChat(postKind, postId))}
      className="btn btn-primary px-4 py-2 text-sm"
    >
      {pending ? "여는 중…" : label}
    </button>
  );
}
