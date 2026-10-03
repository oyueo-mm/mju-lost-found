import { prisma } from "@/lib/db/prisma";
import { notifyUser } from "@/lib/notification/recipients";
import {
  AdminActionProposalType as PrismaProposalType,
  AdminActionAuditEvent as PrismaAuditEvent,
  ModerationActionType as PrismaModerationActionType,
  NotificationType,
  Prisma,
  ReportTargetType as PrismaReportTargetType,
  type AdminActionProposal,
  type User,
} from "@/generated/prisma/client";
import type { AdminActionProposalTypeValue } from "./schema";

// Deliberately NOT imported from moderation/service.ts's own isAdmin() --
// moderation/service.ts::applyReportAction() now calls into this module
// (createAdminActionProposal, below) for its own admin-target suspend
// path, so importing the other direction here would create a module
// cycle. This is the exact same one-line DB-sourced check either way
// (`user.isAdmin`, never a client-controlled value) -- see that function's
// own comment for why it must always come from a fresh session read.
function isAdmin(candidate: Pick<User, "isAdmin">): boolean {
  return candidate.isAdmin;
}

// Phase 관리자 승인제: "관리자 대상 고위험 조치는 관리자 1명이 단독으로 실행할 수
// 없다" -- suspend/unsuspend/demote a *currently admin* target, or grant
// admin to *anyone*, is never applied straight to the User row. It's
// recorded as a PENDING AdminActionProposal instead, and only actually
// applied once enough independent admins (neither the proposer nor the
// target) have approved it -- see approvalRequirementFor() below. Both entry
// points into this policy (admin/users.ts's updateUserByAdmin, for the
// ordinary user-management screen, and createAdminActionProposal below,
// for the dedicated proposal UI) funnel through the exact same
// executeProposalAction()/approveAdminActionProposal() pair, so there is
// exactly one code path that ever writes isAdmin/isSuspended for an
// admin-affecting change -- a client can't reach a second, unguarded path
// by calling either entry point directly.
export const PROPOSAL_EXPIRY_DAYS = 7;

// 관리자 승인 인원 정책 Phase: the required approval count is not a fixed 2
// -- with a fixed 2 (from admins other than the proposer and the target)
// nothing admin-affecting could ever pass with fewer than 3 admins. It is
// derived, at the moment of each decision (never stored), from the
// *eligible approvers*: active admins (isAdmin and not currently suspended
// -- an expired timed suspension counts as active, same as
// isCurrentlySuspended()) other than the proposer and the target:
//
//   required = min(MAX_REQUIRED_APPROVALS, eligible approvers)
//
// so a proposal can always be completed by the admins who are actually
// able to approve it (no approval deadlock). Two exceptions to that
// formula when there are no eligible approvers at all:
// - grant_admin or unsuspend_user (restoring an admin) whose proposer is
//   the one and only active admin: 0 approvals, executed immediately (the
//   "단독 관리자 예외", recorded in the audit log with
//   soleAdminExceptionDetail()). Both can only add an active admin, never
//   remove one.
// - the destructive ones (revoke_admin, suspending an admin): still 1 --
//   never done by one admin alone, so such a proposal waits (flagged in the
//   UI) until an eligible approver exists.
// Independently, no action may leave the service with 0 active admins
// (see LastActiveAdminError). Only approvals by currently eligible
// approvers count toward `required` (an approver who has since been
// suspended no longer counts).
export const MAX_REQUIRED_APPROVALS = 2;

export type ApprovalRequirement = {
  required: number;
  soleAdminException: boolean;
  eligibleApproverIds: number[];
};

export function approvalRequirementFor(
  actionType: AdminActionProposalTypeValue,
  activeAdminIds: number[],
  proposerId: number,
  targetId: number,
): ApprovalRequirement {
  const eligibleApproverIds = activeAdminIds.filter((id) => id !== proposerId && id !== targetId);
  const soleAdminException =
    SOLE_ADMIN_EXCEPTION_ACTIONS.includes(actionType) && activeAdminIds.length === 1 && activeAdminIds[0] === proposerId;
  if (soleAdminException) return { required: 0, soleAdminException, eligibleApproverIds };
  return {
    required: Math.max(1, Math.min(MAX_REQUIRED_APPROVALS, eligibleApproverIds.length)),
    soleAdminException: false,
    eligibleApproverIds,
  };
}

// The action types the sole-admin exception covers -- the two that can
// only add an active admin (see the policy comment above).
export const SOLE_ADMIN_EXCEPTION_ACTIONS: readonly AdminActionProposalTypeValue[] = ["grant_admin", "unsuspend_user"];

// Written to the EXECUTED audit row's `detail`. Every variant starts with
// SOLE_ADMIN_EXCEPTION_PREFIX, which is how an executed proposal is later
// recognized as having used the exception.
export const SOLE_ADMIN_EXCEPTION_PREFIX = "단독 관리자 예외:";
const SOLE_ADMIN_EXCEPTION_ACTION_LABEL: Partial<Record<AdminActionProposalTypeValue, string>> = {
  grant_admin: "관리자 권한 부여",
  unsuspend_user: "관리자 정지 해제",
};

export function soleAdminExceptionDetail(actionType: AdminActionProposalTypeValue): string {
  return `${SOLE_ADMIN_EXCEPTION_PREFIX} 실행 시점 활성 관리자 1명(제안자)뿐이라 승인 없이 ${SOLE_ADMIN_EXCEPTION_ACTION_LABEL[actionType] ?? actionType}를 실행함`;
}

// Raised inside a transaction when executing a proposal would leave zero
// active admins, so the whole transaction (including an approval row that
// would have triggered it) rolls back; callers turn it into "last_admin".
export class LastActiveAdminError extends Error {
  constructor() {
    super("This action would leave no active admin.");
    this.name = "LastActiveAdminError";
  }
}

// One transaction-scoped advisory lock serializes every decision that
// depends on the active-admin count (creating a proposal, approving /
// executing one) across *different* proposals -- the per-proposal row lock
// below only serializes approvals of the same proposal. Without it, two
// "revoke admin" proposals approved concurrently could each see 2 active
// admins, each pass the last-admin check, and together leave 0. Released
// automatically at commit/rollback. $executeRaw, not $queryRaw:
// pg_advisory_xact_lock returns void, which $queryRaw can't deserialize.
const ADMIN_MEMBERSHIP_LOCK_KEY = 72026092901;

async function lockAdminMembership(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${ADMIN_MEMBERSHIP_LOCK_KEY}::bigint)`);
}

function activeAdminWhere(now: Date) {
  return { isAdmin: true, OR: [{ isSuspended: false }, { suspendedUntil: { lte: now } }] };
}

async function findActiveAdminIds(client: Pick<Prisma.TransactionClient, "user">): Promise<number[]> {
  const rows = await client.user.findMany({ where: activeAdminWhere(new Date()), select: { id: true } });
  return rows.map((r) => r.id);
}

function removesActiveAdmin(actionType: PrismaProposalType, targetUserId: number, activeAdminIds: number[]): boolean {
  return (
    (actionType === PrismaProposalType.REVOKE_ADMIN || actionType === PrismaProposalType.SUSPEND_USER) &&
    activeAdminIds.includes(targetUserId)
  );
}

const PROPOSAL_TYPE_TO_DB: Record<AdminActionProposalTypeValue, PrismaProposalType> = {
  suspend_user: PrismaProposalType.SUSPEND_USER,
  unsuspend_user: PrismaProposalType.UNSUSPEND_USER,
  grant_admin: PrismaProposalType.GRANT_ADMIN,
  revoke_admin: PrismaProposalType.REVOKE_ADMIN,
};
const PROPOSAL_TYPE_FROM_DB: Record<PrismaProposalType, AdminActionProposalTypeValue> = {
  SUSPEND_USER: "suspend_user",
  UNSUSPEND_USER: "unsuspend_user",
  GRANT_ADMIN: "grant_admin",
  REVOKE_ADMIN: "revoke_admin",
};

export type AdminActionProposalStatusValue = "pending" | "executed" | "cancelled" | "expired";
const STATUS_FROM_DB: Record<string, AdminActionProposalStatusValue> = {
  PENDING: "pending",
  EXECUTED: "executed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
};

export type AdminActionAuditEventValue = "created" | "approved" | "executed" | "cancelled" | "expired";
const AUDIT_EVENT_FROM_DB: Record<string, AdminActionAuditEventValue> = {
  CREATED: "created",
  APPROVED: "approved",
  EXECUTED: "executed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
};

type UserRef = { id: number; nickname: string | null; publicId: string; isAdmin: boolean } | null;

export type AdminActionApprovalDTO = {
  approvedBy: { id: number; nickname: string | null };
  createdAt: Date;
};

export type AdminActionAuditLogDTO = {
  id: number;
  event: AdminActionAuditEventValue;
  actor: { id: number; nickname: string | null } | null;
  detail: string | null;
  createdAt: Date;
};

export type AdminActionProposalDTO = {
  id: number;
  actionType: AdminActionProposalTypeValue;
  status: AdminActionProposalStatusValue;
  target: UserRef;
  proposedBy: { id: number; nickname: string | null } | null;
  reasonCategory: string | null;
  reason: string | null;
  suspendDurationDays: number | null;
  approvals: AdminActionApprovalDTO[];
  // 관리자 승인 인원 정책 Phase: for a pending (or cancelled/expired)
  // proposal this is computed from the *current* eligible approvers via
  // approvalRequirementFor(); for an executed one it's what it actually took
  // (0 for the sole-admin exception, otherwise the approvals it had).
  requiredApprovals: number;
  // Approvals that count toward requiredApprovals right now -- only those
  // by currently eligible approvers (for an executed proposal: all of them).
  countedApprovals: number;
  approvalsNeeded: number;
  // Eligible approvers right now: active admins other than the proposer and
  // the target.
  eligibleApproverCount: number;
  // Pending, but there are fewer eligible approvers who haven't approved
  // yet than approvals still needed -- only possible when nobody at all is
  // eligible and the action isn't the sole-admin grant (a destructive
  // action is never executed alone); it waits for another active admin.
  insufficientApprovers: boolean;
  executedBySoleAdminException: boolean;
  // The proposer is the only active admin and this is a grant_admin or
  // unsuspend_user: they may execute it themselves (the sole-admin
  // exception) from the list.
  canCurrentAdminSoleExecute: boolean;
  createdAt: Date;
  expiresAt: Date;
  executedAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: { id: number; nickname: string | null } | null;
  // Phase 관리자 승인제: computed relative to the *viewing* admin -- the
  // list page uses this to decide whether to render an 승인 button at all
  // (never just disable it), so a viewer who can't approve never even sees
  // the affordance.
  canCurrentAdminApprove: boolean;
  currentAdminHasApproved: boolean;
};

type ProposalRow = AdminActionProposal & {
  targetUser: { id: number; nickname: string | null; publicId: string; isAdmin: boolean } | null;
  proposedBy: { id: number; nickname: string | null } | null;
  cancelledBy: { id: number; nickname: string | null } | null;
  approvals: { approvedByUserId: number; createdAt: Date; approvedBy: { id: number; nickname: string | null } }[];
  auditLogs?: { detail: string | null }[];
};

function toProposalDTO(row: ProposalRow, viewerAdminId: number, activeAdminIds: number[]): AdminActionProposalDTO {
  const actionType = PROPOSAL_TYPE_FROM_DB[row.actionType];
  const approverIds = row.approvals.map((a) => a.approvedByUserId);
  const currentAdminHasApproved = approverIds.includes(viewerAdminId);
  const viewerIsActive = activeAdminIds.includes(viewerAdminId);
  const isOpen = row.status === "PENDING" && row.expiresAt.getTime() > Date.now();
  const executedBySoleAdminException = (row.auditLogs ?? []).some((l) => l.detail?.startsWith(SOLE_ADMIN_EXCEPTION_PREFIX) ?? false);

  const requirement = approvalRequirementFor(actionType, activeAdminIds, row.proposedByUserId, row.targetUserId);
  const executed = row.status === "EXECUTED";
  const requiredApprovals = executed ? (executedBySoleAdminException ? 0 : row.approvals.length) : requirement.required;
  const countedApprovals = executed
    ? row.approvals.length
    : approverIds.filter((id) => requirement.eligibleApproverIds.includes(id)).length;
  const approvalsNeeded = Math.max(0, requiredApprovals - countedApprovals);
  const remainingApprovers = requirement.eligibleApproverIds.filter((id) => !approverIds.includes(id)).length;

  const canCurrentAdminApprove =
    isOpen &&
    requirement.eligibleApproverIds.includes(viewerAdminId) &&
    !currentAdminHasApproved;
  const canCurrentAdminSoleExecute =
    isOpen && row.proposedByUserId === viewerAdminId && viewerIsActive && requirement.soleAdminException;

  return {
    id: row.id,
    actionType,
    status: STATUS_FROM_DB[row.status],
    target: row.targetUser,
    proposedBy: row.proposedBy,
    reasonCategory: row.reasonCategory,
    reason: row.reason,
    suspendDurationDays: row.suspendDurationDays,
    approvals: row.approvals.map((a) => ({ approvedBy: a.approvedBy, createdAt: a.createdAt })),
    requiredApprovals,
    countedApprovals,
    approvalsNeeded,
    eligibleApproverCount: requirement.eligibleApproverIds.length,
    insufficientApprovers: row.status === "PENDING" && approvalsNeeded > remainingApprovers,
    executedBySoleAdminException,
    canCurrentAdminSoleExecute,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    executedAt: row.executedAt,
    cancelledAt: row.cancelledAt,
    cancelledBy: row.cancelledBy,
    canCurrentAdminApprove,
    currentAdminHasApproved,
  };
}

const PROPOSAL_INCLUDE = {
  targetUser: { select: { id: true, nickname: true, publicId: true, isAdmin: true } },
  proposedBy: { select: { id: true, nickname: true } },
  cancelledBy: { select: { id: true, nickname: true } },
  approvals: { include: { approvedBy: { select: { id: true, nickname: true } } } },
  // Only to tell whether an executed proposal used the sole-admin exception.
  auditLogs: { where: { event: PrismaAuditEvent.EXECUTED }, select: { detail: true } },
} as const;

export type AdminProposalMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "not_pending" }
  | { kind: "expired" }
  // Requested safeguard, mirrors updateUserByAdmin()'s own "self" kind.
  | { kind: "self_proposer" }
  | { kind: "target_cannot_approve" }
  | { kind: "already_approved" }
  | { kind: "pending_more"; needed: number; data: T }
  | { kind: "reason_required" }
  // 관리자 승인 인원 정책 Phase: the action would leave 0 active admins.
  | { kind: "last_admin" };

// Called both by the dedicated proposal-creation UI (via the Server Action
// below) and by admin/users.ts::updateUserByAdmin() when it detects the
// target requires approval -- see that function's own comment for exactly
// which (action, target.isAdmin) combinations route here instead of
// writing the User row directly.
export async function createAdminActionProposal(
  admin: User,
  targetUserId: number,
  actionType: AdminActionProposalTypeValue,
  {
    reasonCategory,
    reason,
    suspendDurationDays,
  }: { reasonCategory?: string; reason?: string; suspendDurationDays?: number },
): Promise<AdminProposalMutationResult<AdminActionProposalDTO>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) return { kind: "not_found" };

  const trimmedReasonCategory = reasonCategory?.trim() || null;
  const trimmedReason = reason?.trim() || null;
  // Same "required only for a suspend" rule as updateUserByAdmin()'s own
  // check -- kept identical so a proposal and a direct suspend never carry
  // different reason requirements for the same effective action.
  if (actionType === "suspend_user" && (!trimmedReasonCategory || !trimmedReason)) {
    return { kind: "reason_required" };
  }

  const expiresAt = new Date(Date.now() + PROPOSAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const dbActionType = PROPOSAL_TYPE_TO_DB[actionType];

  return runGuardingLastAdmin(() =>
    prisma.$transaction(async (tx): Promise<AdminProposalMutationResult<AdminActionProposalDTO>> => {
      await lockAdminMembership(tx);
      const activeAdminIds = await findActiveAdminIds(tx);
      // Refused up front rather than left pending: a proposal that could
      // only ever end with no active admin should not exist at all.
      if (removesActiveAdmin(dbActionType, targetUserId, activeAdminIds) && activeAdminIds.length <= 1) {
        return { kind: "last_admin" };
      }

      const proposal = await tx.adminActionProposal.create({
        data: {
          targetUserId,
          actionType: dbActionType,
          reasonCategory: trimmedReasonCategory,
          reason: trimmedReason,
          suspendDurationDays: suspendDurationDays ?? null,
          proposedByUserId: admin.id,
          expiresAt,
        },
        include: PROPOSAL_INCLUDE,
      });
      await tx.adminActionAuditLog.create({
        data: { proposalId: proposal.id, event: PrismaAuditEvent.CREATED, actorUserId: admin.id },
      });

      if (approvalRequirementFor(actionType, activeAdminIds, admin.id, targetUserId).soleAdminException) {
        const executed = await executeAndMarkProposal(tx, proposal, admin.id, activeAdminIds, soleAdminExceptionDetail(actionType));
        return { kind: "ok", data: toProposalDTO(executed, admin.id, await findActiveAdminIds(tx)) };
      }
      return { kind: "ok", data: toProposalDTO(proposal, admin.id, activeAdminIds) };
    }),
  );
}

async function runGuardingLastAdmin(
  run: () => Promise<AdminProposalMutationResult<AdminActionProposalDTO>>,
): Promise<AdminProposalMutationResult<AdminActionProposalDTO>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof LastActiveAdminError) return { kind: "last_admin" };
    throw error;
  }
}

// Applies the action, flips the proposal to EXECUTED and writes the
// EXECUTED audit row (with `detail` set when the sole-admin exception was
// used), all inside the caller's transaction, which must already hold the
// admin-membership lock. The last-admin check is repeated here as the final
// backstop right before the write -- throwing rolls the whole transaction
// back.
async function executeAndMarkProposal(
  tx: Prisma.TransactionClient,
  proposal: AdminActionProposal,
  actorUserId: number,
  activeAdminIds: number[],
  detail: string | null,
) {
  if (removesActiveAdmin(proposal.actionType, proposal.targetUserId, activeAdminIds) && activeAdminIds.length <= 1) {
    throw new LastActiveAdminError();
  }
  await executeProposalAction(tx, proposal);
  const executed = await tx.adminActionProposal.update({
    where: { id: proposal.id },
    data: { status: "EXECUTED", executedAt: new Date() },
    include: PROPOSAL_INCLUDE,
  });
  await tx.adminActionAuditLog.create({
    data: { proposalId: proposal.id, event: PrismaAuditEvent.EXECUTED, actorUserId, detail },
  });
  return executed;
}

// Lazily flips a PENDING-but-past-expiry proposal to EXPIRED (with its own
// audit log entry) the moment anything touches it -- there is no
// background job in this app (see this project's own "최소 변경" convention
// elsewhere), so expiry is detected on read/write instead of on a
// schedule. Must be called with `tx` already holding the row lock (see
// approveAdminActionProposal/cancelAdminActionProposal) so this check and
// whatever the caller does next observe the exact same row, never a
// second, independently-expired one.
async function expireIfPastDue(
  tx: Prisma.TransactionClient,
  proposal: AdminActionProposal,
): Promise<AdminActionProposal> {
  if (proposal.status !== "PENDING" || proposal.expiresAt.getTime() > Date.now()) return proposal;
  const updated = await tx.adminActionProposal.update({
    where: { id: proposal.id },
    data: { status: "EXPIRED" },
  });
  await tx.adminActionAuditLog.create({
    data: { proposalId: proposal.id, event: PrismaAuditEvent.EXPIRED, actorUserId: null },
  });
  return updated;
}

// The one place a proposal's action is ever actually applied to the User
// row -- called exactly once, via executeAndMarkProposal(), inside the
// transaction that reaches the required approval count (or, for the
// sole-admin exception, the one that creates the proposal). Mirrors
// updateUserByAdmin()'s per-action `data` shape exactly (including the
// USER_SUSPENDED notification and ModerationAction audit row for a
// suspend) so a proposal-executed suspension looks identical, everywhere
// else in the app, to a direct one -- adminUserId on that ModerationAction
// row is the *proposer* (the admin who decided this should happen), not
// the approver who happened to trigger execution; the full trail of who
// approved is in AdminActionApproval/AdminActionAuditLog regardless.
async function executeProposalAction(tx: Prisma.TransactionClient, proposal: AdminActionProposal): Promise<void> {
  switch (proposal.actionType) {
    case PrismaProposalType.SUSPEND_USER: {
      const suspendedUntil = proposal.suspendDurationDays
        ? new Date(Date.now() + proposal.suspendDurationDays * 24 * 60 * 60 * 1000)
        : null;
      const suspendDesc = proposal.suspendDurationDays ? `${proposal.suspendDurationDays}일 정지되었습니다.` : "영구 정지되었습니다.";
      await tx.user.update({
        where: { id: proposal.targetUserId },
        data: { isSuspended: true, suspendedUntil, suspendedByUserId: proposal.proposedByUserId },
      });
      await notifyUser(tx, {
        data: {
          userId: proposal.targetUserId,
          type: NotificationType.USER_SUSPENDED,
          title: "계정 정지 안내",
          content: `계정이 ${suspendDesc}`,
          relatedType: null,
          relatedId: null,
        },
      });
      await tx.moderationAction.create({
        data: {
          reportId: null,
          targetType: PrismaReportTargetType.USER,
          targetId: proposal.targetUserId,
          actionType: PrismaModerationActionType.SUSPEND_USER,
          reason: proposal.reason,
          reasonCategory: proposal.reasonCategory,
          adminUserId: proposal.proposedByUserId,
          expiresAt: suspendedUntil,
        },
      });
      return;
    }
    case PrismaProposalType.UNSUSPEND_USER: {
      await tx.user.update({
        where: { id: proposal.targetUserId },
        data: { isSuspended: false, suspendedUntil: null, suspendedByUserId: null },
      });
      return;
    }
    case PrismaProposalType.GRANT_ADMIN: {
      await tx.user.update({ where: { id: proposal.targetUserId }, data: { isAdmin: true } });
      return;
    }
    case PrismaProposalType.REVOKE_ADMIN: {
      await tx.user.update({ where: { id: proposal.targetUserId }, data: { isAdmin: false } });
      return;
    }
  }
}

// The one function that can move a proposal from PENDING to EXECUTED.
// Concurrency-safety argument (this is the part a client-side check can
// never provide):
//
// 1. `SELECT ... FOR UPDATE` on this exact proposal row is the very first
//    statement inside the transaction, before anything else is read --
//    this takes a row-level lock that a second concurrent
//    approveAdminActionProposal() call for the *same* proposal must wait
//    on until this transaction commits or rolls back. Without this lock,
//    two admins approving within the same instant could each compute
//    "1 existing approval + my own = still short of 2" from their own
//    transaction's snapshot (Postgres's default READ COMMITTED isolation
//    only sees committed writes from *other* transactions), both commit,
//    and the proposal would sit at 2 real approval rows forever without
//    ever executing -- a lost-update race, not a double-execution one, but
//    still a correctness bug. The lock forces the second call to start its
//    own read only after the first has fully committed (or rolled back),
//    so it always counts the true, current approval total.
// 2. The AdminActionApproval unique index (proposalId, approvedByUserId)
//    is the backstop against the *same* admin approving twice -- caught
//    here as a Prisma P2002 error and converted to "already_approved".
// 3. Execution itself (executeProposalAction) runs inside this same
//    locked transaction, guarded by re-checking `status === "PENDING"`
//    immediately beforehand -- so even if two different requests somehow
//    both reached the "count >= REQUIRED_APPROVALS" branch (impossible
//    under the row lock above, but defended anyway), only the one that
//    successfully flips status to EXECUTED first would matter; this
//    function never executes twice for one proposal because the second
//    caller's own lock-wait would see status already EXECUTED and return
//    "not_pending" instead.
// 4. 관리자 승인 인원 정책 Phase: right after the row lock, the
//    admin-membership advisory lock (always taken in this order: proposal
//    row, then membership) serializes this against every other
//    count-dependent decision, and the required approval count is then
//    computed from the active admins as of *now*, not from the proposal's
//    creation time.
export async function approveAdminActionProposal(
  admin: User,
  proposalId: number,
): Promise<AdminProposalMutationResult<AdminActionProposalDTO>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  return runGuardingLastAdmin(() =>
    prisma.$transaction(async (tx): Promise<AdminProposalMutationResult<AdminActionProposalDTO>> => {
      const locked = await tx.$queryRaw<{ id: number }[]>(
        Prisma.sql`SELECT id FROM "AdminActionProposal" WHERE id = ${proposalId} FOR UPDATE`,
      );
      if (locked.length === 0) return { kind: "not_found" };

      let proposal = await tx.adminActionProposal.findUniqueOrThrow({ where: { id: proposalId } });
      proposal = await expireIfPastDue(tx, proposal);

      if (proposal.status !== "PENDING") {
        return { kind: proposal.status === "EXPIRED" ? "expired" : "not_pending" };
      }

      await lockAdminMembership(tx);
      const activeAdminIds = await findActiveAdminIds(tx);
      // A suspended admin still has isAdmin, but doesn't count toward the
      // quorum, so they can't approve either.
      if (!activeAdminIds.includes(admin.id)) return { kind: "forbidden" };
      const actionType = PROPOSAL_TYPE_FROM_DB[proposal.actionType];

      // Requested safeguards: neither the proposer nor the target may ever
      // approve their own proposal, checked here (not just in the UI) so a
      // direct API call can't bypass it either -- mirrors
      // updateUserByAdmin()'s own "self" check for the direct-action path.
      // The one exception: a grant_admin / unsuspend_user whose proposer is
      // now the only active admin may be executed by that proposer (the
      // sole-admin exception, e.g. the other admins left after it was
      // proposed).
      if (proposal.proposedByUserId === admin.id) {
        if (!approvalRequirementFor(actionType, activeAdminIds, admin.id, proposal.targetUserId).soleAdminException) {
          return { kind: "self_proposer" };
        }
        const executed = await executeAndMarkProposal(tx, proposal, admin.id, activeAdminIds, soleAdminExceptionDetail(actionType));
        return { kind: "ok", data: toProposalDTO(executed, admin.id, await findActiveAdminIds(tx)) };
      }
      if (proposal.targetUserId === admin.id) return { kind: "target_cannot_approve" };

      try {
        await tx.adminActionApproval.create({ data: { proposalId, approvedByUserId: admin.id } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return { kind: "already_approved" };
        }
        throw error;
      }
      await tx.adminActionAuditLog.create({
        data: { proposalId, event: PrismaAuditEvent.APPROVED, actorUserId: admin.id },
      });

      // Recomputed now, under the membership lock: only approvals by admins
      // who are *currently* eligible count (one who has since been
      // suspended no longer does), against min(2, eligible approvers).
      const { required, eligibleApproverIds } = approvalRequirementFor(
        actionType,
        activeAdminIds,
        proposal.proposedByUserId,
        proposal.targetUserId,
      );
      const approvals = await tx.adminActionApproval.findMany({ where: { proposalId }, select: { approvedByUserId: true } });
      const approvalCount = approvals.filter((a) => eligibleApproverIds.includes(a.approvedByUserId)).length;
      if (approvalCount < required) {
        const refreshed = await tx.adminActionProposal.findUniqueOrThrow({
          where: { id: proposalId },
          include: PROPOSAL_INCLUDE,
        });
        return {
          kind: "pending_more",
          needed: required - approvalCount,
          data: toProposalDTO(refreshed, admin.id, activeAdminIds),
        };
      }

      const executed = await executeAndMarkProposal(tx, proposal, admin.id, activeAdminIds, null);
      return { kind: "ok", data: toProposalDTO(executed, admin.id, await findActiveAdminIds(tx)) };
    }),
  );
}

// Only the original proposer may cancel, and only while still PENDING --
// mirrors this phase's own spec ("제안자는 실행 전까지만 취소 가능"). Same
// row-lock pattern as approveAdminActionProposal so a cancel racing an
// in-flight approval can't leave the two tables disagreeing about status.
export async function cancelAdminActionProposal(
  admin: User,
  proposalId: number,
): Promise<AdminProposalMutationResult<AdminActionProposalDTO>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM "AdminActionProposal" WHERE id = ${proposalId} FOR UPDATE`,
    );
    if (locked.length === 0) return { kind: "not_found" };

    let proposal = await tx.adminActionProposal.findUniqueOrThrow({ where: { id: proposalId } });
    proposal = await expireIfPastDue(tx, proposal);

    if (proposal.proposedByUserId !== admin.id) return { kind: "forbidden" };
    if (proposal.status !== "PENDING") {
      return { kind: proposal.status === "EXPIRED" ? ("expired" as const) : ("not_pending" as const) };
    }

    const cancelled = await tx.adminActionProposal.update({
      where: { id: proposalId },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByUserId: admin.id },
      include: PROPOSAL_INCLUDE,
    });
    await tx.adminActionAuditLog.create({
      data: { proposalId, event: PrismaAuditEvent.CANCELLED, actorUserId: admin.id },
    });

    return { kind: "ok" as const, data: toProposalDTO(cancelled, admin.id, await findActiveAdminIds(tx)) };
  });
}

const PROPOSAL_LIST_CAP = 200;

// Lists every proposal (any status) for the admin UI's history view,
// lazily expiring any stale PENDING rows it encounters first -- see
// expireIfPastDue's own comment for why this is detected on read rather
// than on a schedule. Newest first; capped rather than paginated, same
// "low-volume admin table" convention feedback/service.ts's
// getMyFeedback() already uses.
export async function listAdminActionProposalsForAdmin(
  admin: User,
): Promise<AdminProposalMutationResult<AdminActionProposalDTO[]>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const stale = await prisma.adminActionProposal.findMany({
    where: { status: "PENDING", expiresAt: { lte: new Date() } },
    select: { id: true },
  });
  for (const { id } of stale) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "AdminActionProposal" WHERE id = ${id} FOR UPDATE`);
      const row = await tx.adminActionProposal.findUniqueOrThrow({ where: { id } });
      await expireIfPastDue(tx, row);
    });
  }

  const [rows, activeAdminIds] = await Promise.all([
    prisma.adminActionProposal.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PROPOSAL_LIST_CAP,
      include: PROPOSAL_INCLUDE,
    }),
    findActiveAdminIds(prisma),
  ]);

  return { kind: "ok", data: rows.map((row) => toProposalDTO(row, admin.id, activeAdminIds)) };
}

export async function getAdminActionAuditLogForAdmin(
  admin: User,
  proposalId: number,
): Promise<AdminProposalMutationResult<AdminActionAuditLogDTO[]>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const proposal = await prisma.adminActionProposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return { kind: "not_found" };

  const rows = await prisma.adminActionAuditLog.findMany({
    where: { proposalId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { actor: { select: { id: true, nickname: true } } },
  });

  return {
    kind: "ok",
    data: rows.map((row) => ({
      id: row.id,
      event: AUDIT_EVENT_FROM_DB[row.event],
      actor: row.actor,
      detail: row.detail,
      createdAt: row.createdAt,
    })),
  };
}
