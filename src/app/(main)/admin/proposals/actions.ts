"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { releaseResolvedWithdrawnIdentitiesSafely } from "@/lib/auth/identityRelease";
import { approveAdminActionProposal, cancelAdminActionProposal } from "@/lib/admin/proposals";

export type ProposalActionState = { error: string } | { ok: true };

const LOCKED_KIND_MESSAGES: Record<string, string> = {
  not_found: "제안을 찾을 수 없습니다.",
  not_pending: "이미 처리되었거나 취소된 제안입니다.",
  expired: "만료된 제안입니다.",
  self_proposer: "제안자는 자신의 제안을 승인할 수 없습니다.",
  target_cannot_approve: "조치 대상 관리자는 이 제안을 승인할 수 없습니다.",
  already_approved: "이미 승인한 제안입니다.",
  // Also returned for a suspended admin, who doesn't count toward (or take
  // part in) approvals -- see approveAdminActionProposal().
  forbidden: "활성 관리자만 처리할 수 있습니다.",
  last_admin: "활성 관리자가 0명이 되는 조치는 할 수 없습니다.",
};

// requireAdmin() re-verifies both "logged in" and "DB-flagged admin" from a
// fresh session read, same gate every other admin Server Action in this
// app uses -- approveAdminActionProposal() itself re-checks isAdmin()
// again regardless, same belt-and-suspenders convention.
export async function approveProposalAction(proposalId: number): Promise<ProposalActionState> {
  const admin = await requireAdmin();
  const result = await approveAdminActionProposal(admin, proposalId);
  if (result.kind === "ok") await releaseResolvedWithdrawnIdentitiesSafely();
  if (result.kind === "ok" || result.kind === "pending_more") {
    revalidatePath("/admin/proposals");
    return { ok: true };
  }
  return { error: LOCKED_KIND_MESSAGES[result.kind] ?? "승인하지 못했습니다." };
}

export async function cancelProposalAction(proposalId: number): Promise<ProposalActionState> {
  const admin = await requireAdmin();
  const result = await cancelAdminActionProposal(admin, proposalId);
  if (result.kind === "ok") await releaseResolvedWithdrawnIdentitiesSafely();
  if (result.kind === "ok") {
    revalidatePath("/admin/proposals");
    return { ok: true };
  }
  return { error: LOCKED_KIND_MESSAGES[result.kind] ?? "취소하지 못했습니다." };
}
