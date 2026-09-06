"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { PostType } from "@/lib/posts/schema";

type AdminPostDeleteButtonProps = {
  id: number;
  type: PostType;
  title: string;
};

// Admin counterpart of post/DeletePostButton.tsx: same confirm() gate and
// pending/error UI, but targets the admin-only endpoint
// (/api/admin/posts/[id], not /api/posts/[id]) so it works regardless of
// who owns the post, and refreshes the current admin list in place instead
// of navigating away to a board page.
export function AdminPostDeleteButton({ id, type, title }: AdminPostDeleteButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!confirm(`'${title}' 게시물을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;

    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/posts/${id}?type=${type}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "삭제하지 못했습니다.");
        setPending(false);
        return;
      }
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
      setPending(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {error && <p className="text-xs text-destructive">{error}</p>}
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className="rounded-full border border-destructive/40 px-3.5 py-1.5 text-sm font-medium text-destructive hover:bg-destructive-muted disabled:opacity-60"
      >
        {pending ? "삭제 중..." : "삭제"}
      </button>
    </div>
  );
}
