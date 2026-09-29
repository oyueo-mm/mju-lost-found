import { beforeEach, describe, expect, it, vi } from "vitest";

class FakePrismaClientKnownRequestError extends Error {
  code: string;
  constructor(code: string) {
    super("mock prisma error");
    this.code = code;
  }
}

const user = { findUnique: vi.fn(), findMany: vi.fn() };

// tx-scoped spies -- separate from any top-level table so assertions on
// e.g. txAdminActionProposal.update don't collide with a top-level read.
const txQueryRaw = vi.fn();
const txExecuteRaw = vi.fn();
const txAdminActionProposal = { create: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() };
const txAdminActionApproval = { create: vi.fn(), findMany: vi.fn() };
const txAdminActionAuditLog = { create: vi.fn() };
const txUser = { update: vi.fn(), findMany: vi.fn() };
const txNotification = { create: vi.fn() };
const txModerationAction = { create: vi.fn() };

const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({
    $queryRaw: txQueryRaw,
    $executeRaw: txExecuteRaw,
    adminActionProposal: txAdminActionProposal,
    adminActionApproval: txAdminActionApproval,
    adminActionAuditLog: txAdminActionAuditLog,
    user: txUser,
    notification: txNotification,
    moderationAction: txModerationAction,
  }),
);

const adminActionProposal = { findMany: vi.fn() };

vi.mock("@/lib/db/prisma", () => ({
  prisma: { user, adminActionProposal, $transaction },
}));
vi.mock("@/lib/moderation/service", () => ({ isAdmin: (u: { isAdmin: boolean }) => u.isAdmin }));
vi.mock("@/generated/prisma/client", () => ({
  AdminActionProposalType: {
    SUSPEND_USER: "SUSPEND_USER",
    UNSUSPEND_USER: "UNSUSPEND_USER",
    GRANT_ADMIN: "GRANT_ADMIN",
    REVOKE_ADMIN: "REVOKE_ADMIN",
  },
  AdminActionAuditEvent: { CREATED: "CREATED", APPROVED: "APPROVED", EXECUTED: "EXECUTED", CANCELLED: "CANCELLED", EXPIRED: "EXPIRED" },
  ModerationActionType: { SUSPEND_USER: "SUSPEND_USER" },
  NotificationType: { USER_SUSPENDED: "USER_SUSPENDED" },
  ReportTargetType: { USER: "USER" },
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    PrismaClientKnownRequestError: FakePrismaClientKnownRequestError,
  },
}));

const {
  createAdminActionProposal,
  approveAdminActionProposal,
  cancelAdminActionProposal,
  listAdminActionProposalsForAdmin,
  approvalRequirementFor,
  MAX_REQUIRED_APPROVALS,
  SOLE_ADMIN_EXCEPTION_PREFIX,
  soleAdminExceptionDetail,
} = await import("./proposals");

const proposer = { id: 1, isAdmin: true };
const approverA = { id: 2, isAdmin: true };
const approverB = { id: 3, isAdmin: true };
const target = { id: 5, isAdmin: true };
const nonAdmin = { id: 9, isAdmin: false };

function proposalRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 100,
    targetUserId: target.id,
    actionType: "SUSPEND_USER",
    reasonCategory: "욕설/비방",
    reason: "반복적인 욕설",
    suspendDurationDays: 7,
    status: "PENDING",
    proposedByUserId: proposer.id,
    createdAt: new Date(),
    // Always 7 days out from "now" -- must stay safely in the future
    // regardless of when this test suite actually runs, or every test
    // using this default would trip the lazy-expiration branch in
    // expireIfPastDue() unexpectedly (a fixed past-relative-to-"today"
    // literal date did exactly that once real time caught up to it).
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    executedAt: null,
    cancelledAt: null,
    cancelledByUserId: null,
    targetUser: { id: target.id, nickname: "대상", publicId: "target-uuid", isAdmin: true },
    proposedBy: { id: proposer.id, nickname: "제안자" },
    cancelledBy: null,
    approvals: [],
    ...overrides,
  };
}

// Active admins (isAdmin and not currently suspended) as the DB would
// return them. Default: proposer, both approvers and the target -- 4
// active admins, so every pre-existing test keeps its original meaning
// (2 approvals required).
function setActiveAdmins(ids: number[]) {
  const rows = ids.map((id) => ({ id }));
  txUser.findMany.mockResolvedValue(rows);
  user.findMany.mockResolvedValue(rows);
}

beforeEach(() => {
  vi.clearAllMocks();
  txQueryRaw.mockResolvedValue([{ id: 100 }]);
  txExecuteRaw.mockResolvedValue(1);
  setActiveAdmins([proposer.id, approverA.id, approverB.id, target.id]);
});

describe("createAdminActionProposal", () => {
  it("rejects a non-admin caller", async () => {
    const result = await createAdminActionProposal(nonAdmin as never, target.id, "suspend_user", {});
    expect(result).toEqual({ kind: "forbidden" });
  });

  it("returns not_found for a nonexistent target", async () => {
    user.findUnique.mockResolvedValueOnce(null);
    const result = await createAdminActionProposal(proposer as never, 999, "suspend_user", {});
    expect(result).toEqual({ kind: "not_found" });
  });

  it("requires both a reason category and detail for suspend_user, same as a direct suspend", async () => {
    user.findUnique.mockResolvedValueOnce(target);
    const result = await createAdminActionProposal(proposer as never, target.id, "suspend_user", {});
    expect(result).toEqual({ kind: "reason_required" });
    expect(txAdminActionProposal.create).not.toHaveBeenCalled();
  });

  it("creates a PENDING proposal expiring 7 days out and logs a CREATED audit entry", async () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(start);
    try {
      user.findUnique.mockResolvedValueOnce(target);
      txAdminActionProposal.create.mockResolvedValueOnce(proposalRow());

      const result = await createAdminActionProposal(proposer as never, target.id, "suspend_user", {
        reasonCategory: "욕설/비방",
        reason: "반복적인 욕설",
        suspendDurationDays: 7,
      });

      expect(result.kind).toBe("ok");
      const createCall = txAdminActionProposal.create.mock.calls[0][0];
      expect(createCall.data.expiresAt).toEqual(new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000));
      expect(txAdminActionAuditLog.create).toHaveBeenCalledWith({
        data: { proposalId: 100, event: "CREATED", actorUserId: proposer.id },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("approveAdminActionProposal", () => {
  it("rejects a non-admin caller", async () => {
    const result = await approveAdminActionProposal(nonAdmin as never, 100);
    expect(result).toEqual({ kind: "forbidden" });
  });

  it("returns not_found when the row lock finds nothing", async () => {
    txQueryRaw.mockResolvedValueOnce([]);
    const result = await approveAdminActionProposal(proposer as never, 999);
    expect(result).toEqual({ kind: "not_found" });
  });

  it("rejects the proposer approving their own proposal, without inserting an approval", async () => {
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());
    const result = await approveAdminActionProposal(proposer as never, 100);
    expect(result).toEqual({ kind: "self_proposer" });
    expect(txAdminActionApproval.create).not.toHaveBeenCalled();
  });

  it("rejects the target admin approving the proposal against themselves", async () => {
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());
    const result = await approveAdminActionProposal(target as never, 100);
    expect(result).toEqual({ kind: "target_cannot_approve" });
    expect(txAdminActionApproval.create).not.toHaveBeenCalled();
  });

  it("converts a duplicate-approval unique-constraint violation into already_approved", async () => {
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());
    txAdminActionApproval.create.mockRejectedValueOnce(new FakePrismaClientKnownRequestError("P2002"));

    const result = await approveAdminActionProposal(approverA as never, 100);

    expect(result).toEqual({ kind: "already_approved" });
  });

  it("rethrows a non-P2002 error from the approval insert", async () => {
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());
    txAdminActionApproval.create.mockRejectedValueOnce(new Error("db down"));

    await expect(approveAdminActionProposal(approverA as never, 100)).rejects.toThrow("db down");
  });

  it("does not execute after only the first of two required approvals", async () => {
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());
    txAdminActionApproval.findMany.mockResolvedValueOnce([{ approvedByUserId: approverA.id }]);
    // approveAdminActionProposal() re-fetches the (now one-approval)
    // proposal with its full include set to build the DTO it returns
    // alongside "pending_more" -- a second call to the same mock.
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());

    const result = await approveAdminActionProposal(approverA as never, 100);

    expect(result.kind).toBe("pending_more");
    if (result.kind === "pending_more") expect(result.needed).toBe(MAX_REQUIRED_APPROVALS - 1);
    expect(txUser.update).not.toHaveBeenCalled();
    expect(txAdminActionProposal.update).not.toHaveBeenCalled();
  });

  it("executes the suspend exactly once, in the same transaction, the instant the second distinct admin approves", async () => {
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());
    txAdminActionApproval.findMany.mockResolvedValueOnce([{ approvedByUserId: approverA.id }, { approvedByUserId: approverB.id }]);
    txAdminActionProposal.update.mockResolvedValueOnce(
      proposalRow({ status: "EXECUTED", executedAt: new Date("2026-01-02") }),
    );

    const result = await approveAdminActionProposal(approverB as never, 100);

    expect(result.kind).toBe("ok");
    expect(txUser.update).toHaveBeenCalledWith({
      where: { id: target.id },
      data: { isSuspended: true, suspendedUntil: expect.any(Date), suspendedByUserId: proposer.id },
    });
    expect(txModerationAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reportId: null, targetId: target.id, adminUserId: proposer.id }),
      }),
    );
    expect(txAdminActionProposal.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: "EXECUTED", executedAt: expect.any(Date) },
      include: expect.anything(),
    });
    expect(txAdminActionAuditLog.create).toHaveBeenCalledWith({
      data: { proposalId: 100, event: "EXECUTED", actorUserId: approverB.id, detail: null },
    });
  });

  it("locks the row with SELECT ... FOR UPDATE before reading the proposal, so concurrent approvals serialize", async () => {
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());
    txAdminActionApproval.findMany.mockResolvedValueOnce([{ approvedByUserId: approverA.id }]);
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());

    await approveAdminActionProposal(approverA as never, 100);

    expect(txQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("rejects approving an already-EXECUTED proposal", async () => {
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow({ status: "EXECUTED" }));
    const result = await approveAdminActionProposal(approverA as never, 100);
    expect(result).toEqual({ kind: "not_pending" });
  });

  it("lazily expires a PENDING proposal past its expiresAt and rejects the approval", async () => {
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(
      proposalRow({ expiresAt: new Date("2020-01-01T00:00:00.000Z") }),
    );
    txAdminActionProposal.update.mockResolvedValueOnce(proposalRow({ status: "EXPIRED" }));

    const result = await approveAdminActionProposal(approverA as never, 100);

    expect(result).toEqual({ kind: "expired" });
    expect(txAdminActionProposal.update).toHaveBeenCalledWith({ where: { id: 100 }, data: { status: "EXPIRED" } });
    expect(txAdminActionAuditLog.create).toHaveBeenCalledWith({
      data: { proposalId: 100, event: "EXPIRED", actorUserId: null },
    });
    expect(txAdminActionApproval.create).not.toHaveBeenCalled();
  });
});

describe("cancelAdminActionProposal", () => {
  it("rejects a non-proposer trying to cancel", async () => {
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());
    const result = await cancelAdminActionProposal(approverA as never, 100);
    expect(result).toEqual({ kind: "forbidden" });
    expect(txAdminActionProposal.update).not.toHaveBeenCalled();
  });

  it("lets the proposer cancel their own pending proposal", async () => {
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());
    txAdminActionProposal.update.mockResolvedValueOnce(
      proposalRow({ status: "CANCELLED", cancelledByUserId: proposer.id }),
    );

    const result = await cancelAdminActionProposal(proposer as never, 100);

    expect(result.kind).toBe("ok");
    expect(txAdminActionProposal.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: "CANCELLED", cancelledAt: expect.any(Date), cancelledByUserId: proposer.id },
      include: expect.anything(),
    });
  });

  it("rejects cancelling a proposal that already executed", async () => {
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow({ status: "EXECUTED" }));
    const result = await cancelAdminActionProposal(proposer as never, 100);
    expect(result).toEqual({ kind: "not_pending" });
  });
});

// ---------------------------------------------------------------------------
// 관리자 승인 인원 정책 Phase
// ---------------------------------------------------------------------------
const newcomer = { id: 9, nickname: "신규", publicId: "newcomer-uuid", isAdmin: false };

function grantRow(overrides: Partial<Record<string, unknown>> = {}) {
  return proposalRow({
    actionType: "GRANT_ADMIN",
    targetUserId: newcomer.id,
    targetUser: newcomer,
    reasonCategory: null,
    reason: null,
    suspendDurationDays: null,
    ...overrides,
  });
}

describe("approvalRequirementFor: min(2, eligible approvers)", () => {
  const P = proposer.id;
  const T = target.id;
  const N = newcomer.id;

  it("grant_admin: sole active admin -> 0 (sole-admin exception); otherwise min(2, eligible)", () => {
    expect(approvalRequirementFor("grant_admin", [P], P, N)).toEqual({ required: 0, soleAdminException: true, eligibleApproverIds: [] });
    expect(approvalRequirementFor("grant_admin", [P, 2], P, N).required).toBe(1);
    expect(approvalRequirementFor("grant_admin", [P, 2, 3], P, N).required).toBe(2);
    expect(approvalRequirementFor("grant_admin", [P, 2, 3, 4, 6], P, N).required).toBe(2);
  });

  it("excludes the proposer and the target from the eligible approvers (no more 3-admin deadlock)", () => {
    // 3 active admins, revoking one of them: only 1 admin can approve -> 1 required, not 2.
    const r = approvalRequirementFor("revoke_admin", [P, 2, T], P, T);
    expect(r.eligibleApproverIds).toEqual([2]);
    expect(r.required).toBe(1);
    expect(approvalRequirementFor("suspend_user", [P, 2, 3, T], P, T).required).toBe(2);
  });

  it("never lets a destructive action go solo: 0 eligible approvers still means 1 required", () => {
    for (const type of ["revoke_admin", "suspend_user"] as const) {
      expect(approvalRequirementFor(type, [P, T], P, T)).toEqual({ required: 1, soleAdminException: false, eligibleApproverIds: [] });
      expect(approvalRequirementFor(type, [P], P, T).soleAdminException).toBe(false);
    }
  });

  it("covers unsuspend_user (restoring a suspended admin) with the sole-admin exception too", () => {
    // The suspended target is not an active admin, so the proposer is the only one.
    expect(approvalRequirementFor("unsuspend_user", [P], P, T)).toEqual({ required: 0, soleAdminException: true, eligibleApproverIds: [] });
    expect(approvalRequirementFor("unsuspend_user", [P, 2], P, T).required).toBe(1);
    expect(approvalRequirementFor("unsuspend_user", [P, 2, 3], P, T).required).toBe(2);
    expect(approvalRequirementFor("unsuspend_user", [2], P, T).soleAdminException).toBe(false);
  });

  it("writes a per-action audit reason that always carries the sole-admin prefix", () => {
    expect(soleAdminExceptionDetail("grant_admin")).toContain("관리자 권한 부여");
    expect(soleAdminExceptionDetail("unsuspend_user")).toContain("관리자 정지 해제");
    for (const type of ["grant_admin", "unsuspend_user"] as const) {
      expect(soleAdminExceptionDetail(type).startsWith(SOLE_ADMIN_EXCEPTION_PREFIX)).toBe(true);
    }
  });

  it("does not grant the sole-admin exception to a proposer who is not the active admin", () => {
    expect(approvalRequirementFor("grant_admin", [2], P, N)).toEqual({ required: 1, soleAdminException: false, eligibleApproverIds: [2] });
    expect(approvalRequirementFor("grant_admin", [], P, N)).toEqual({ required: 1, soleAdminException: false, eligibleApproverIds: [] });
  });
});

describe("createAdminActionProposal -- active-admin policy", () => {
  it("executes a grant_admin immediately when the proposer is the only active admin, logging the sole-admin reason", async () => {
    setActiveAdmins([proposer.id]);
    user.findUnique.mockResolvedValueOnce(newcomer);
    txAdminActionProposal.create.mockResolvedValueOnce(grantRow());
    txAdminActionProposal.update.mockResolvedValueOnce(
      grantRow({ status: "EXECUTED", executedAt: new Date(), auditLogs: [{ detail: soleAdminExceptionDetail("grant_admin") }] }),
    );

    const result = await createAdminActionProposal(proposer as never, newcomer.id, "grant_admin", {});

    expect(result.kind).toBe("ok");
    expect(txUser.update).toHaveBeenCalledWith({ where: { id: newcomer.id }, data: { isAdmin: true } });
    expect(txAdminActionProposal.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: "EXECUTED", executedAt: expect.any(Date) },
      include: expect.anything(),
    });
    expect(txAdminActionAuditLog.create).toHaveBeenCalledWith({
      data: { proposalId: 100, event: "EXECUTED", actorUserId: proposer.id, detail: soleAdminExceptionDetail("grant_admin") },
    });
    if (result.kind === "ok") {
      expect(result.data.status).toBe("executed");
      expect(result.data.executedBySoleAdminException).toBe(true);
      expect(result.data.requiredApprovals).toBe(0);
    }
  });

  it("executes an unsuspend of a suspended admin immediately when the proposer is the only active admin", async () => {
    setActiveAdmins([proposer.id]); // the target admin is suspended, so not active
    user.findUnique.mockResolvedValueOnce({ ...target, isSuspended: true });
    txAdminActionProposal.create.mockResolvedValueOnce(
      proposalRow({ actionType: "UNSUSPEND_USER", reason: null, reasonCategory: null, suspendDurationDays: null }),
    );
    txAdminActionProposal.update.mockResolvedValueOnce(
      proposalRow({
        actionType: "UNSUSPEND_USER",
        status: "EXECUTED",
        executedAt: new Date(),
        auditLogs: [{ detail: soleAdminExceptionDetail("unsuspend_user") }],
      }),
    );

    const result = await createAdminActionProposal(proposer as never, target.id, "unsuspend_user", {});

    expect(result.kind).toBe("ok");
    expect(txUser.update).toHaveBeenCalledWith({
      where: { id: target.id },
      data: { isSuspended: false, suspendedUntil: null, suspendedByUserId: null },
    });
    expect(txAdminActionAuditLog.create).toHaveBeenCalledWith({
      data: { proposalId: 100, event: "EXECUTED", actorUserId: proposer.id, detail: soleAdminExceptionDetail("unsuspend_user") },
    });
    if (result.kind === "ok") {
      expect(result.data.status).toBe("executed");
      expect(result.data.executedBySoleAdminException).toBe(true);
      expect(result.data.requiredApprovals).toBe(0);
    }
  });

  it("keeps an unsuspend pending (1 approval) when another active admin can approve it", async () => {
    setActiveAdmins([proposer.id, approverA.id]);
    user.findUnique.mockResolvedValueOnce({ ...target, isSuspended: true });
    txAdminActionProposal.create.mockResolvedValueOnce(proposalRow({ actionType: "UNSUSPEND_USER" }));

    const result = await createAdminActionProposal(proposer as never, target.id, "unsuspend_user", {});

    expect(txUser.update).not.toHaveBeenCalled();
    if (result.kind === "ok") {
      expect(result.data.status).toBe("pending");
      expect(result.data.requiredApprovals).toBe(1);
    }
  });

  it("takes the admin-membership lock before counting active admins", async () => {
    setActiveAdmins([proposer.id]);
    user.findUnique.mockResolvedValueOnce(newcomer);
    txAdminActionProposal.create.mockResolvedValueOnce(grantRow());
    txAdminActionProposal.update.mockResolvedValueOnce(grantRow({ status: "EXECUTED" }));

    await createAdminActionProposal(proposer as never, newcomer.id, "grant_admin", {});

    expect(txExecuteRaw).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(txExecuteRaw.mock.calls[0][0])).toContain("pg_advisory_xact_lock");
    expect(txExecuteRaw.mock.invocationCallOrder[0]).toBeLessThan(txUser.findMany.mock.invocationCallOrder[0]);
  });

  it("does not use the exception when the proposer is suspended (not the active admin)", async () => {
    setActiveAdmins([approverA.id]);
    user.findUnique.mockResolvedValueOnce(newcomer);
    txAdminActionProposal.create.mockResolvedValueOnce(grantRow());

    const result = await createAdminActionProposal(proposer as never, newcomer.id, "grant_admin", {});

    expect(result.kind).toBe("ok");
    expect(txUser.update).not.toHaveBeenCalled();
    if (result.kind === "ok") {
      expect(result.data.status).toBe("pending");
      expect(result.data.requiredApprovals).toBe(1);
    }
  });

  it("leaves a grant_admin pending with 1 required approval when there are 2 active admins", async () => {
    setActiveAdmins([proposer.id, approverA.id]);
    user.findUnique.mockResolvedValueOnce(newcomer);
    txAdminActionProposal.create.mockResolvedValueOnce(grantRow());

    const result = await createAdminActionProposal(proposer as never, newcomer.id, "grant_admin", {});

    expect(txUser.update).not.toHaveBeenCalled();
    if (result.kind === "ok") {
      expect(result.data.status).toBe("pending");
      expect(result.data.requiredApprovals).toBe(1);
      expect(result.data.approvalsNeeded).toBe(1);
      expect(result.data.insufficientApprovers).toBe(false);
    }
  });

  it("requires 2 approvals for a grant_admin with 3 active admins", async () => {
    setActiveAdmins([proposer.id, approverA.id, approverB.id]);
    user.findUnique.mockResolvedValueOnce(newcomer);
    txAdminActionProposal.create.mockResolvedValueOnce(grantRow());

    const result = await createAdminActionProposal(proposer as never, newcomer.id, "grant_admin", {});

    if (result.kind === "ok") expect(result.data.requiredApprovals).toBe(2);
    expect(txUser.update).not.toHaveBeenCalled();
  });

  it("never executes a revoke_admin alone: with 2 active admins it waits for an approver who is not there yet", async () => {
    setActiveAdmins([proposer.id, target.id]);
    user.findUnique.mockResolvedValueOnce(target);
    txAdminActionProposal.create.mockResolvedValueOnce(
      proposalRow({ actionType: "REVOKE_ADMIN", reason: null, reasonCategory: null }),
    );

    const result = await createAdminActionProposal(proposer as never, target.id, "revoke_admin", {});

    expect(txUser.update).not.toHaveBeenCalled();
    if (result.kind === "ok") {
      expect(result.data.status).toBe("pending");
      expect(result.data.requiredApprovals).toBe(1);
      expect(result.data.insufficientApprovers).toBe(true);
    }
  });

  it("with 3 active admins, a revoke of one of them needs just the 1 admin who can approve it", async () => {
    setActiveAdmins([proposer.id, approverA.id, target.id]);
    user.findUnique.mockResolvedValueOnce(target);
    txAdminActionProposal.create.mockResolvedValueOnce(
      proposalRow({ actionType: "REVOKE_ADMIN", reason: null, reasonCategory: null }),
    );

    const result = await createAdminActionProposal(proposer as never, target.id, "revoke_admin", {});

    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.data.requiredApprovals).toBe(1);
    expect(result.data.eligibleApproverCount).toBe(1);
    expect(result.data.insufficientApprovers).toBe(false);
    expect(txUser.update).not.toHaveBeenCalled();
  });

  it("refuses to even create a revoke_admin that would leave zero active admins", async () => {
    setActiveAdmins([target.id]);
    user.findUnique.mockResolvedValueOnce(target);

    const result = await createAdminActionProposal(proposer as never, target.id, "revoke_admin", {});

    expect(result).toEqual({ kind: "last_admin" });
    expect(txAdminActionProposal.create).not.toHaveBeenCalled();
    expect(txUser.update).not.toHaveBeenCalled();
  });

  it("refuses to create a suspend of the last active admin", async () => {
    setActiveAdmins([target.id]);
    user.findUnique.mockResolvedValueOnce(target);

    const result = await createAdminActionProposal(proposer as never, target.id, "suspend_user", {
      reasonCategory: "기타",
      reason: "사유",
    });

    expect(result).toEqual({ kind: "last_admin" });
    expect(txAdminActionProposal.create).not.toHaveBeenCalled();
  });

  it("still allows proposing a suspend of an admin who is already not active, but never executes it alone", async () => {
    setActiveAdmins([proposer.id]);
    user.findUnique.mockResolvedValueOnce(target);
    txAdminActionProposal.create.mockResolvedValueOnce(proposalRow());

    const result = await createAdminActionProposal(proposer as never, target.id, "suspend_user", {
      reasonCategory: "기타",
      reason: "사유",
    });

    expect(result.kind).toBe("ok");
    expect(txUser.update).not.toHaveBeenCalled();
  });
});

describe("approveAdminActionProposal -- active-admin policy", () => {
  it("takes the proposal row lock first and the admin-membership lock second", async () => {
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());
    txAdminActionApproval.findMany.mockResolvedValueOnce([{ approvedByUserId: approverA.id }]);
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());

    await approveAdminActionProposal(approverA as never, 100);

    expect(txQueryRaw.mock.invocationCallOrder[0]).toBeLessThan(txExecuteRaw.mock.invocationCallOrder[0]);
    expect(txExecuteRaw.mock.invocationCallOrder[0]).toBeLessThan(txUser.findMany.mock.invocationCallOrder[0]);
  });

  it("executes a grant_admin on the first approval when there are 2 active admins", async () => {
    setActiveAdmins([proposer.id, approverA.id]);
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(grantRow());
    txAdminActionApproval.findMany.mockResolvedValueOnce([{ approvedByUserId: approverA.id }]);
    txAdminActionProposal.update.mockResolvedValueOnce(grantRow({ status: "EXECUTED", executedAt: new Date() }));

    const result = await approveAdminActionProposal(approverA as never, 100);

    expect(result.kind).toBe("ok");
    expect(txUser.update).toHaveBeenCalledWith({ where: { id: newcomer.id }, data: { isAdmin: true } });
    expect(txAdminActionAuditLog.create).toHaveBeenCalledWith({
      data: { proposalId: 100, event: "EXECUTED", actorUserId: approverA.id, detail: null },
    });
  });

  it("computes the requirement at approval time, not creation time (3 active admins now -> needs 2)", async () => {
    setActiveAdmins([proposer.id, approverA.id, approverB.id]);
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(grantRow());
    txAdminActionApproval.findMany.mockResolvedValueOnce([{ approvedByUserId: approverA.id }]);
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(grantRow());

    const result = await approveAdminActionProposal(approverA as never, 100);

    expect(result.kind).toBe("pending_more");
    if (result.kind === "pending_more") {
      expect(result.needed).toBe(1);
      expect(result.data.requiredApprovals).toBe(2);
    }
    expect(txUser.update).not.toHaveBeenCalled();
  });

  it("executes a revoke among 3 active admins on the single eligible approval (the former deadlock)", async () => {
    setActiveAdmins([proposer.id, approverA.id, target.id]);
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow({ actionType: "REVOKE_ADMIN" }));
    txAdminActionApproval.findMany.mockResolvedValueOnce([{ approvedByUserId: approverA.id }]);
    txAdminActionProposal.update.mockResolvedValueOnce(proposalRow({ actionType: "REVOKE_ADMIN", status: "EXECUTED" }));

    const result = await approveAdminActionProposal(approverA as never, 100);

    expect(result.kind).toBe("ok");
    expect(txUser.update).toHaveBeenCalledWith({ where: { id: target.id }, data: { isAdmin: false } });
    expect(txAdminActionAuditLog.create).toHaveBeenCalledWith({
      data: { proposalId: 100, event: "EXECUTED", actorUserId: approverA.id, detail: null },
    });
  });

  it("does not count an approval by an admin who has since been suspended", async () => {
    const approverC = { id: 4, isAdmin: true };
    // approverA (2) approved earlier but is now suspended; eligible = B and C -> 2 required.
    setActiveAdmins([proposer.id, approverB.id, approverC.id, target.id]);
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());
    txAdminActionApproval.findMany.mockResolvedValueOnce([{ approvedByUserId: approverA.id }, { approvedByUserId: approverB.id }]);
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());

    const result = await approveAdminActionProposal(approverB as never, 100);

    expect(result.kind).toBe("pending_more");
    if (result.kind === "pending_more") expect(result.needed).toBe(1);
    expect(txUser.update).not.toHaveBeenCalled();
  });

  it("rejects a suspended admin's approval (they don't count as active)", async () => {
    setActiveAdmins([proposer.id, approverB.id, target.id]);
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());

    const result = await approveAdminActionProposal(approverA as never, 100);

    expect(result).toEqual({ kind: "forbidden" });
    expect(txAdminActionApproval.create).not.toHaveBeenCalled();
  });

  it("lets the proposer execute their own pending grant_admin once they are the only active admin", async () => {
    setActiveAdmins([proposer.id]);
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(grantRow());
    txAdminActionProposal.update.mockResolvedValueOnce(
      grantRow({ status: "EXECUTED", executedAt: new Date(), auditLogs: [{ detail: soleAdminExceptionDetail("grant_admin") }] }),
    );

    const result = await approveAdminActionProposal(proposer as never, 100);

    expect(result.kind).toBe("ok");
    expect(txAdminActionApproval.create).not.toHaveBeenCalled();
    expect(txUser.update).toHaveBeenCalledWith({ where: { id: newcomer.id }, data: { isAdmin: true } });
    expect(txAdminActionAuditLog.create).toHaveBeenCalledWith({
      data: { proposalId: 100, event: "EXECUTED", actorUserId: proposer.id, detail: soleAdminExceptionDetail("grant_admin") },
    });
  });

  it("lets the proposer execute their own pending unsuspend once they are the only active admin", async () => {
    setActiveAdmins([proposer.id]);
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow({ actionType: "UNSUSPEND_USER" }));
    txAdminActionProposal.update.mockResolvedValueOnce(proposalRow({ actionType: "UNSUSPEND_USER", status: "EXECUTED" }));

    const result = await approveAdminActionProposal(proposer as never, 100);

    expect(result.kind).toBe("ok");
    expect(txAdminActionApproval.create).not.toHaveBeenCalled();
    expect(txAdminActionAuditLog.create).toHaveBeenCalledWith({
      data: { proposalId: 100, event: "EXECUTED", actorUserId: proposer.id, detail: soleAdminExceptionDetail("unsuspend_user") },
    });
  });

  it("still rejects the proposer approving a suspend of an admin as the only active admin (no solo exception)", async () => {
    setActiveAdmins([proposer.id]);
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow({ actionType: "SUSPEND_USER" }));

    const result = await approveAdminActionProposal(proposer as never, 100);

    expect(result).toEqual({ kind: "self_proposer" });
    expect(txUser.update).not.toHaveBeenCalled();
  });

  it("still rejects the proposer approving a revoke_admin even as the only active admin (no solo exception)", async () => {
    setActiveAdmins([proposer.id]);
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow({ actionType: "REVOKE_ADMIN" }));

    const result = await approveAdminActionProposal(proposer as never, 100);

    expect(result).toEqual({ kind: "self_proposer" });
    expect(txUser.update).not.toHaveBeenCalled();
  });

  it("allows a revoke_admin that leaves exactly one active admin", async () => {
    setActiveAdmins([approverA.id, target.id]);
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow({ actionType: "REVOKE_ADMIN" }));
    txAdminActionApproval.findMany.mockResolvedValueOnce([{ approvedByUserId: approverA.id }]);
    txAdminActionProposal.update.mockResolvedValueOnce(proposalRow({ actionType: "REVOKE_ADMIN", status: "EXECUTED" }));

    const result = await approveAdminActionProposal(approverA as never, 100);

    expect(result.kind).toBe("ok");
    expect(txUser.update).toHaveBeenCalledWith({ where: { id: target.id }, data: { isAdmin: false } });
  });
});

describe("listAdminActionProposalsForAdmin -- displayed requirement", () => {
  it("shows the requirement computed from the current active admin count and marks sole-admin executions", async () => {
    setActiveAdmins([proposer.id, approverA.id]);
    adminActionProposal.findMany
      .mockResolvedValueOnce([]) // stale-expiry scan
      .mockResolvedValueOnce([
        grantRow({ id: 1 }),
        grantRow({ id: 2, status: "EXECUTED", auditLogs: [{ detail: soleAdminExceptionDetail("grant_admin") }] }),
        grantRow({
          id: 3,
          status: "EXECUTED",
          approvals: [{ approvedByUserId: approverA.id, createdAt: new Date(), approvedBy: { id: approverA.id, nickname: "A" } }],
        }),
      ]);

    const result = await listAdminActionProposalsForAdmin(approverA as never);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const [pendingGrant, soleExecuted, approvedExecuted] = result.data;
    expect(pendingGrant.requiredApprovals).toBe(1);
    expect(pendingGrant.canCurrentAdminApprove).toBe(true);
    expect(soleExecuted.requiredApprovals).toBe(0);
    expect(soleExecuted.executedBySoleAdminException).toBe(true);
    expect(approvedExecuted.requiredApprovals).toBe(1);
    expect(approvedExecuted.executedBySoleAdminException).toBe(false);
  });

  it("flags a destructive proposal with no eligible approver and excludes suspended approvals from the count", async () => {
    setActiveAdmins([proposer.id, target.id]);
    adminActionProposal.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      proposalRow({
        actionType: "REVOKE_ADMIN",
        // approverA approved before being suspended -- no longer counts.
        approvals: [{ approvedByUserId: approverA.id, createdAt: new Date(), approvedBy: { id: approverA.id, nickname: "A" } }],
      }),
    ]);

    const result = await listAdminActionProposalsForAdmin(proposer as never);

    if (result.kind !== "ok") throw new Error("expected ok");
    const [row] = result.data;
    expect(row.requiredApprovals).toBe(1);
    expect(row.countedApprovals).toBe(0);
    expect(row.approvalsNeeded).toBe(1);
    expect(row.eligibleApproverCount).toBe(0);
    expect(row.insufficientApprovers).toBe(true);
    expect(row.canCurrentAdminSoleExecute).toBe(false);
  });

  it("offers the sole-execute action only to the proposer when they are the only active admin", async () => {
    setActiveAdmins([proposer.id]);
    adminActionProposal.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([grantRow()]);

    const asProposer = await listAdminActionProposalsForAdmin(proposer as never);

    if (asProposer.kind !== "ok") throw new Error("expected ok");
    expect(asProposer.data[0].requiredApprovals).toBe(0);
    expect(asProposer.data[0].canCurrentAdminSoleExecute).toBe(true);
    expect(asProposer.data[0].canCurrentAdminApprove).toBe(false);
  });
});
