"use client";

import { useTransition } from "react";
import { deleteNotice } from "@/lib/admin-actions";

export default function DeleteNoticeButton({ id }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (confirm("이 공지를 삭제할까요? 사용자 알림함에서도 사라져요.")) {
          startTransition(() => deleteNotice(id));
        }
      }}
      className="shrink-0 text-xs font-semibold text-rose-600 transition hover:text-rose-700 disabled:opacity-50"
    >
      {pending ? "삭제 중…" : "삭제"}
    </button>
  );
}
