"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { PostType } from "@/lib/posts/schema";

export function DeletePostButton({ id, type }: { id: number; type: PostType }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!confirm("정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) return;

    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${id}?type=${type}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "삭제하지 못했습니다.");
        setPending(false);
        return;
      }
      router.push(type === "lost" ? "/lost" : "/found");
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className="rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-600 disabled:opacity-60 dark:border-red-900 dark:text-red-400"
      >
        {pending ? "삭제 중..." : "삭제"}
      </button>
    </div>
  );
}
