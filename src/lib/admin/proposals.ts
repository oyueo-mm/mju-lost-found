import { prisma } from "@/lib/db/prisma";
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
// applied once two independent admins (neither the proposer nor the
// target) have approved it -- see REQUIRED_APPROVALS below. Both entry
// points into this policy (admin/users.ts's updateUserByAdmin, for the
// ordinary user-management screen, and createAdminActionProposal below,
// for the dedicated proposal UI) funnel through the exact same
// executeProposalAction()/approveAdminActionProposal() pair, so there is
// exactly one code path that ever writes isAdmin/isSuspended for an
// admin-affecting change -- a client can't reach a second, unguarded path
// by calling either entry point directly.
export const REQUIRED_APPROVALS = 2;
export const PROPOSAL_EXPIRY_DAYS = 7;

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
  requiredApprovals: number;
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
};

function toProposalDTO(row: ProposalRow, viewerAdminId: number): AdminActionProposalDTO {
  const currentAdminHasApproved = row.approvals.some((a) => a.approvedByUserId === viewerAdminId);
  const canCurrentAdminApprove =
    row.status === "PENDING" &&
    row.expiresAt.getTime() > Date.now() &&
    row.proposedByUserId !== viewerAdminId &&
    row.targetUserId !== viewerAdminId &&
    !currentAdminHasApproved;

  return {
    id: row.id,
    actionType: PROPOSAL_TYPE_FROM_DB[row.actionType],
    status: STATUS_FROM_DB[row.status],
    target: row.targetUser,
    proposedBy: row.proposedBy,
    reasonCategory: row.reasonCategory,
    reason: row.reason,
    suspendDurationDays: row.suspendDurationDays,
    approvals: row.approvals.map((a) => ({ approvedBy: a.approvedBy, createdAt: a.createdAt })),
    requiredApprovals: REQUIRED_APPROVALS,
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
  | { kind: "reason_required" };

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

  const created = await prisma.$transaction(async (tx) => {
    const proposal = await tx.adminActionProposal.create({
      data: {
        targetUserId,
        actionType: PROPOSAL_TYPE_TO_DB[actionType],
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
    return proposal;
  });

  return { kind: "ok", data: toProposalDTO(created, admin.id) };
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
// row -- called exactly once, from inside approveAdminActionProposal()'s
// own transaction, the instant the second valid approval lands. Mirrors
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
      await tx.notification.create({
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
export async function approveAdminActionProposal(
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

    if (proposal.status !== "PENDING") {
      return { kind: proposal.status === "EXPIRED" ? ("expired" as const) : ("not_pending" as const) };
    }
    // Requested safeguards: neither the proposer nor the target may ever
    // approve their own proposal, checked here (not just in the UI) so a
    // direct API call can't bypass it either -- mirrors
    // updateUserByAdmin()'s own "self" check for the direct-action path.
    if (proposal.proposedByUserId === admin.id) return { kind: "self_proposer" as const };
    if (proposal.targetUserId === admin.id) return { kind: "target_cannot_approve" as const };

    try {
      await tx.adminActionApproval.create({ data: { proposalId, approvedByUserId: admin.id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { kind: "already_approved" as const };
      }
      throw error;
    }
    await tx.adminActionAuditLog.create({
      data: { proposalId, event: PrismaAuditEvent.APPROVED, actorUserId: admin.id },
    });

    const approvalCount = await tx.adminActionApproval.count({ where: { proposalId } });
    if (approvalCount < REQUIRED_APPROVALS) {
      const refreshed = await tx.adminActionProposal.findUniqueOrThrow({
        where: { id: proposalId },
        include: PROPOSAL_INCLUDE,
      });
      return {
        kind: "pending_more" as const,
        needed: REQUIRED_APPROVALS - approvalCount,
        data: toProposalDTO(refreshed, admin.id),
      };
    }

    await executeProposalAction(tx, proposal);
    const executed = await tx.adminActionProposal.update({
      where: { id: proposalId },
      data: { status: "EXECUTED", executedAt: new Date() },
      include: PROPOSAL_INCLUDE,
    });
    await tx.adminActionAuditLog.create({
      data: { proposalId, event: PrismaAuditEvent.EXECUTED, actorUserId: admin.id },
    });

    return { kind: "ok" as const, data: toProposalDTO(executed, admin.id) };
  });
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

    return { kind: "ok" as const, data: toProposalDTO(cancelled, admin.id) };
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

  const rows = await prisma.adminActionProposal.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PROPOSAL_LIST_CAP,
    include: PROPOSAL_INCLUDE,
  });

  return { kind: "ok", data: rows.map((row) => toProposalDTO(row, admin.id)) };
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
