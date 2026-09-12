"use client";

import { useActionState, useEffect, useRef } from "react";
import { addComment } from "@/lib/comment-actions";

export default function CommentForm({ postType, postId }) {
  const [state, formAction, pending] = useActionState(
    addComment.bind(null, postType, postId),
    null,
  );
  const ref = useRef(null);

  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={formAction} className="mt-3">
      <div className="flex gap-2">
        <input
          name="content"
          maxLength={500}
          autoComplete="off"
          placeholder="댓글 남기기 (예: 이거 학관 3층에서 본 것 같아요)"
          className="min-w-0 flex-1 rounded-full border border-line bg-sunken px-4 py-2 text-sm outline-none transition focus:border-brand focus:bg-surface"
        />
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary px-4 py-2 text-sm"
        >
          등록
        </button>
      </div>
      {state?.error && (
        <p className="mt-1 px-1 text-xs text-brand-deep">{state.error}</p>
      )}
    </form>
  );
}
