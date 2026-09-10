"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  approveOrganizationCreationRequestAction,
  rejectOrganizationCreationRequestAction,
} from "@/app/(main)/admin/organization-requests/actions";
import { Button } from "@/components/ui/Button";

const FIELD_CLASS =
  "rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-sm text-foreground disabled:opacity-60";

type OrganizationRequestReviewFormProps = {
  requestId: number;
};

// Phase 12-3: PENDING 신청에만 렌더링된다(페이지가 status로 분기) -- 승인은
// adminNote만 선택적으로 받고, 거절은 rejectionReason을 필수로 받는다(§11).
// 두 액션 모두 requireAdmin() + service 자체의 isAdmin() 재검증을 거친다.
export function OrganizationRequestReviewForm({ requestId }: OrganizationRequestReviewFormProps) {
  const router = useRouter();
  const [adminNote, setAdminNote] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [pendingAction, setPendingAction] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    if (pendingAction) return;
    setPendingAction("approve");
    setError(null);

    const result = await approveOrganizationCreationRequestAction(requestId, { adminNote: adminNote || undefined });
    if ("error" in result) {
      setError(result.error);
      setPendingAction(null);
      return;
    }

    setPendingAction(null);
    router.refresh();
  }

  async function handleReject(event: React.FormEvent) {
    event.preventDefault();
    if (pendingAction) return;
    setPendingAction("reject");
    setError(null);

    const result = await rejectOrganizationCreationRequestAction(requestId, {
      rejectionReason,
      adminNote: adminNote || undefined,
    });
    if ("error" in result) {
      setError(result.error);
      setPendingAction(null);
      return;
    }

    setPendingAction(null);
    router.refresh();
  }

  return (
    <form onSubmit={handleReject} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">관리자 메모 (선택)</span>
        <textarea
          value={adminNote}
          onChange={(e) => setAdminNote(e.target.value)}
          maxLength={2000}
          rows={2}
          disabled={pendingAction !== null}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">거절 사유 (거절 시 필수)</span>
        <textarea
          value={rejectionReason}
          onChange={(e) => setRejectionReason(e.target.value)}
          maxLength={1000}
          rows={3}
          disabled={pendingAction !== null}
          className={FIELD_CLASS}
        />
      </label>

      {error && (
        <p className="rounded-card border border-destructive/30 bg-destructive-muted px-3.5 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={handleApprove} disabled={pendingAction !== null}>
          {pendingAction === "approve" ? "승인 처리 중..." : "승인"}
        </Button>
        <Button type="submit" variant="destructive" size="sm" disabled={pendingAction !== null || !rejectionReason.trim()}>
          {pendingAction === "reject" ? "거절 처리 중..." : "거절"}
        </Button>
      </div>
    </form>
  );
}
