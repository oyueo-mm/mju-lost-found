"use client";

import { useTransition } from "react";
import { adminDeletePost } from "@/lib/admin-actions";

export default function AdminPostControls({ kind, id }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (confirm("이 게시글을 삭제할까요?")) {
          startTransition(() => adminDeletePost(kind, id));
        }
      }}
      className="btn px-3 py-1.5 text-xs text-brand-deep hover:bg-brand-tint"
    >
      {pending ? "…" : "삭제"}
    </button>
  );
}
