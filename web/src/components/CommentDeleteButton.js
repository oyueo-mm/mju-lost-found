"use client";

import { useTransition } from "react";
import { deleteComment } from "@/lib/comment-actions";

export default function CommentDeleteButton({ commentId, postType, postId }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (confirm("댓글을 삭제할까요?")) {
          startTransition(() =>
            deleteComment(commentId, postType, postId),
          );
        }
      }}
      className="text-xs text-ink-faint hover:text-brand-deep"
    >
      삭제
    </button>
  );
}
