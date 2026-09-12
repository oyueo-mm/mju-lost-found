"use client";

import { deletePost } from "@/lib/post-actions";

export default function DeletePostButton({ kind, id }) {
  return (
    <form
      action={deletePost.bind(null, kind, id)}
      onSubmit={(e) => {
        if (!confirm("이 게시글을 삭제할까요? 되돌릴 수 없어요.")) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="btn px-4 py-2 text-sm text-brand-deep hover:bg-brand-tint"
      >
        삭제
      </button>
    </form>
  );
}
