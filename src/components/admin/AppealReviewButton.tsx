"use client";

import { useState, useTransition } from "react";

import { reviewAppealAction } from "@/app/(main)/admin/sanctions/actions";
import { Button } from "@/components/ui/Button";

// Phase I: the one admin-side workflow step this phase's minimal appeal
// structure has (see moderation/appeals.ts's own top comment) -- marks the
// appeal reviewed, nothing more. Whether to actually unsuspend the target
// user is a separate, already-existing action (UserActionButtons' own
// "정지 해제"), not something this button drives.
export function AppealReviewButton({ appealId }: { appealId: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!confirm("이 이의신청을 확인 완료로 표시하시겠습니까?")) return;
    setError(null);
    startTransition(async () => {
      const result = await reviewAppealAction(appealId);
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="secondary" size="sm" onClick={handleClick} disabled={pending}>
        {pending ? "처리 중..." : "확인 처리"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
