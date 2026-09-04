"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "처리하지 못했습니다.");
        return;
      }
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || pending}
        className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:border-zinc-400 disabled:opacity-60 dark:border-zinc-700 dark:hover:border-zinc-600"
      >
        {pending ? "처리 중..." : "모두 읽음 처리"}
      </button>
    </div>
  );
}
