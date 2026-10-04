"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";

// Lifts the temporary hide (임시 숨김) report [reportId] applied -- POST
// /api/admin/reports/[id]/restore, which re-checks admin rights and
// records the release as its own ModerationAction.
export function RestoreTempHideButton({ reportId }: { reportId: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (pending || !window.confirm("임시 숨김을 해제하고 다시 공개할까요? 작성자에게 알림이 갑니다.")) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports/${reportId}/restore`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "해제하지 못했습니다.");
        return;
      }
      router.refresh();
    } catch {
      setError("해제하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={handleClick} className="self-start">
        {pending ? "처리 중..." : "임시 숨김 해제"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
