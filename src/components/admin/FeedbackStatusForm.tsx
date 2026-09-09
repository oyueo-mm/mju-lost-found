"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { updateFeedbackStatusAction } from "@/app/(main)/admin/feedback/actions";
import { FEEDBACK_STATUSES, FEEDBACK_STATUS_LABELS, type FeedbackStatusValue } from "@/lib/feedback/schema";
import { Button } from "@/components/ui/Button";

type FeedbackStatusFormProps = {
  feedbackId: number;
  currentStatus: FeedbackStatusValue;
  currentAdminNote: string | null;
};

// Same "direct Server Action call inside a plain async handler" convention
// as CreateAnnouncementForm.tsx/FeedbackForm.tsx.
export function FeedbackStatusForm({ feedbackId, currentStatus, currentAdminNote }: FeedbackStatusFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState<FeedbackStatusValue>(currentStatus);
  const [adminNote, setAdminNote] = useState(currentAdminNote ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const result = await updateFeedbackStatusAction(feedbackId, { status, adminNote });
    if ("error" in result) {
      setError(result.error);
      setPending(false);
      return;
    }

    setPending(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">상태</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="처리 상태 선택">
          {FEEDBACK_STATUSES.map((s) => (
            <Button
              key={s}
              type="button"
              variant={status === s ? "primary" : "secondary"}
              size="sm"
              aria-pressed={status === s}
              disabled={pending}
              onClick={() => setStatus(s)}
              className="h-8 px-3 text-xs"
            >
              {FEEDBACK_STATUS_LABELS[s]}
            </Button>
          ))}
        </div>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">관리자 메모 (선택, 사용자에게 노출되지 않음)</span>
        <textarea
          value={adminNote}
          onChange={(e) => setAdminNote(e.target.value)}
          maxLength={2000}
          rows={3}
          disabled={pending}
          className="rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-sm text-foreground disabled:opacity-60"
        />
      </label>

      {error && (
        <p className="rounded-card border border-destructive/30 bg-destructive-muted px-3.5 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {pending ? "저장 중..." : "저장"}
      </Button>
    </form>
  );
}
