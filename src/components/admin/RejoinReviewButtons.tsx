"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { reviewRejoinRequestAction } from "@/app/(main)/admin/rejoin-requests/actions";
import { Button } from "@/components/ui/Button";

export function RejoinReviewButtons({ requestId }: { requestId: number }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: "approve" | "reject") {
    const question =
      decision === "approve"
        ? "승인하면 이 사용자가 다음 로그인 때 새 계정으로 가입합니다. 승인할까요?"
        : "거절하면 이 Google 계정으로는 가입할 수 없습니다. 거절할까요?";
    if (!window.confirm(question)) return;
    setError(null);
    startTransition(async () => {
      const result = await reviewRejoinRequestAction(requestId, decision, note);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={1000}
        disabled={pending}
        placeholder="처리 메모 (선택)"
        className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground disabled:opacity-60"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => decide("approve")}>
          승인
        </Button>
        <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => decide("reject")}>
          거절
        </Button>
      </div>
    </div>
  );
}
