"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  approveOrganizationJoinRequestAction,
  rejectOrganizationJoinRequestAction,
} from "@/app/(main)/organizations/[id]/settings/actions";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ORGANIZATION_REQUEST_STATUS_LABELS, type OrganizationRequestStatusValue } from "@/lib/organization/schema";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

type JoinRequest = {
  id: number;
  message: string | null;
  status: OrganizationRequestStatusValue;
  rejectionReason: string | null;
  createdAt: Date;
  requester: { id: number; nickname: string | null; publicId: string };
};

// Phase 12-4 §12-15: PENDING 요청에만 승인/거절 버튼을 보여준다. §25: 신청자
// 표시는 닉네임만(publicId는 표시하지 않음 -- 단체 구성원 목록과 동일하게
// 여기서도 인증/식별 정보를 최소화).
export function OrganizationJoinRequestQueue({ organizationId, requests }: { organizationId: number; requests: JoinRequest[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  async function handleApprove(requestId: number) {
    setPendingId(requestId);
    setError(null);
    const result = await approveOrganizationJoinRequestAction(organizationId, requestId);
    setPendingId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleReject(requestId: number) {
    setPendingId(requestId);
    setError(null);
    const result = await rejectOrganizationJoinRequestAction(organizationId, requestId, {
      rejectionReason: rejectionReason.trim() || undefined,
    });
    setPendingId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setRejectingId(null);
    setRejectionReason("");
    router.refresh();
  }

  if (requests.length === 0) {
    return <EmptyState title="가입 신청이 없습니다" />;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="flex flex-col gap-3">
        {requests.map((request) => (
          <li key={request.id} className="flex flex-col gap-2 rounded-lg border border-border p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{request.requester.nickname ?? "닉네임 미설정"}</span>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {ORGANIZATION_REQUEST_STATUS_LABELS[request.status]}
              </span>
            </div>
            {request.message && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{request.message}</p>}
            <span className="text-xs text-muted-foreground/70">신청일: {formatDate(request.createdAt)}</span>
            {request.status === "rejected" && request.rejectionReason && (
              <span className="text-xs text-destructive">거절 사유: {request.rejectionReason}</span>
            )}

            {request.status === "pending" && (
              <div className="flex flex-col gap-2 pt-1">
                {rejectingId === request.id ? (
                  <div className="flex flex-col gap-2">
                    <input
                      type="text"
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      maxLength={1000}
                      placeholder="거절 사유 (선택)"
                      disabled={pendingId === request.id}
                      className="rounded-lg border border-border bg-transparent px-3.5 py-2 text-sm text-foreground disabled:opacity-60"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={pendingId === request.id}
                        onClick={() => handleReject(request.id)}
                      >
                        {pendingId === request.id ? "처리 중..." : "거절 확정"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pendingId === request.id}
                        onClick={() => {
                          setRejectingId(null);
                          setRejectionReason("");
                        }}
                      >
                        취소
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" disabled={pendingId === request.id} onClick={() => handleApprove(request.id)}>
                      {pendingId === request.id ? "처리 중..." : "승인"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pendingId === request.id}
                      onClick={() => setRejectingId(request.id)}
                    >
                      거절
                    </Button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
