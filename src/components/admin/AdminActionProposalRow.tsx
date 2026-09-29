"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { AdminActionProposalDTO } from "@/lib/admin/proposals";
import { ADMIN_ACTION_PROPOSAL_TYPE_LABELS } from "@/lib/admin/schema";
import { approveProposalAction, cancelProposalAction } from "@/app/(main)/admin/proposals/actions";
import { AuthorLink } from "@/components/user/AuthorLink";
import { Button } from "@/components/ui/Button";

const STATUS_LABELS: Record<AdminActionProposalDTO["status"], string> = {
  pending: "대기 중",
  executed: "실행 완료",
  cancelled: "취소됨",
  expired: "만료됨",
};

const STATUS_BADGE_CLASS: Record<AdminActionProposalDTO["status"], string> = {
  pending: "bg-primary-muted text-primary",
  executed: "bg-emerald-500/15 text-emerald-600",
  cancelled: "bg-muted text-muted-foreground",
  expired: "bg-destructive-muted text-destructive",
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(
    date,
  );
}

// Phase 관리자 승인제: one row per AdminActionProposal on /admin/proposals --
// shows the fixed set of fields this phase's own spec asks for (대상/조치
// 내용/사유/제안자/승인 현황/생성·만료 시각), and only ever renders an 승인
// button when the *server-computed* canCurrentAdminApprove says so
// (data.canCurrentAdminApprove, from admin/proposals.ts::toProposalDTO) --
// never a client-side guess re-derived from ids, so an admin who can't
// approve (proposer, target, or already approved) never even sees the
// affordance, matching this phase's own "승인 가능한 관리자에게만 보이는
// 승인 버튼" requirement.
export function AdminActionProposalRow({
  proposal,
  isProposer,
}: {
  proposal: AdminActionProposalDTO;
  isProposer: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    if (
      proposal.canCurrentAdminSoleExecute &&
      !confirm("현재 활성 관리자가 본인 1명뿐이라 승인 없이 바로 실행됩니다. 실행하시겠습니까?")
    ) {
      return;
    }
    setPending(true);
    setError(null);
    const result = await approveProposalAction(proposal.id);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleCancel() {
    if (!confirm("이 제안을 취소하시겠습니까?")) return;
    setPending(true);
    setError(null);
    const result = await cancelProposalAction(proposal.id);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  // 관리자 승인 인원 정책 Phase: requiredApprovals / countedApprovals /
  // approvalsNeeded come from the server -- min(2, eligible approvers right
  // now), counting only approvals by currently eligible approvers -- so this
  // row never re-derives them.
  const { approvalsNeeded } = proposal;
  const uncountedApprovals = proposal.status === "pending" ? proposal.approvals.length - proposal.countedApprovals : 0;

  return (
    <div className="flex flex-col gap-2 border-b border-border p-4 text-sm last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE_CLASS[proposal.status]}`}>
          {STATUS_LABELS[proposal.status]}
        </span>
        <span className="font-medium text-foreground">{ADMIN_ACTION_PROPOSAL_TYPE_LABELS[proposal.actionType]}</span>
        {proposal.suspendDurationDays !== null && proposal.actionType === "suspend_user" && (
          <span className="text-xs text-muted-foreground">({proposal.suspendDurationDays}일)</span>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        대상:{" "}
        {proposal.target ? (
          <AuthorLink
            nickname={proposal.target.nickname}
            publicId={proposal.target.publicId}
            className="font-medium text-foreground hover:underline"
          />
        ) : (
          "탈퇴한 사용자"
        )}
        {" · 제안자: "}
        <span className="text-foreground">{proposal.proposedBy?.nickname ?? "알 수 없음"}</span>
      </div>

      {(proposal.reasonCategory || proposal.reason) && (
        <p className="text-xs text-muted-foreground">
          사유: {proposal.reasonCategory ? `[${proposal.reasonCategory}] ` : ""}
          {proposal.reason}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        {proposal.executedBySoleAdminException ? (
          "단독 관리자 예외로 승인 없이 실행됨 (실행 당시 활성 관리자 1명)"
        ) : (
          <>
            승인 {proposal.countedApprovals}/{proposal.requiredApprovals}
            {proposal.approvals.length > 0 &&
              ` (${proposal.approvals.map((a) => a.approvedBy.nickname ?? "알 수 없음").join(", ")})`}
            {uncountedApprovals > 0 && ` · 정지된 관리자 승인 ${uncountedApprovals}건 제외`}
            {proposal.status === "pending" && approvalsNeeded > 0 && ` · ${approvalsNeeded}명 승인 필요`}
            {proposal.status === "pending" && proposal.canCurrentAdminSoleExecute && " · 활성 관리자 1명: 단독 실행 가능"}
          </>
        )}
      </p>

      {proposal.status === "pending" && proposal.insufficientApprovers && (
        <p className="text-xs text-destructive">
          제안자·대상자를 제외하면 승인할 수 있는 활성 관리자가 없어요. 관리자 권한 해제·관리자 정지는 단독으로 실행할 수
          없으므로, 다른 활성 관리자가 생기면 그 관리자가 승인할 수 있어요.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        생성: {formatDate(proposal.createdAt)} · 만료: {formatDate(proposal.expiresAt)}
        {proposal.executedAt && ` · 실행: ${formatDate(proposal.executedAt)}`}
        {proposal.cancelledAt && ` · 취소: ${formatDate(proposal.cancelledAt)} (${proposal.cancelledBy?.nickname ?? "알 수 없음"})`}
      </p>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {proposal.status === "pending" && (
        <div className="flex gap-2">
          {(proposal.canCurrentAdminApprove || proposal.canCurrentAdminSoleExecute) && (
            <Button type="button" size="sm" onClick={handleApprove} disabled={pending}>
              {pending ? "처리 중..." : proposal.canCurrentAdminSoleExecute ? "단독 실행" : "승인"}
            </Button>
          )}
          {proposal.currentAdminHasApproved && !proposal.canCurrentAdminApprove && (
            <span className="self-center text-xs text-muted-foreground">이미 승인함</span>
          )}
          {isProposer && (
            <Button type="button" variant="secondary" size="sm" onClick={handleCancel} disabled={pending}>
              {pending ? "처리 중..." : "제안 취소"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
