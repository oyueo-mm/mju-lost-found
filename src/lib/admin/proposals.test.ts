import { beforeEach, describe, expect, it, vi } from "vitest";

class FakePrismaClientKnownRequestError extends Error {
  code: string;
  constructor(code: string) {
    super("mock prisma error");
    this.code = code;
  }
}

const user = { findUnique: vi.fn() };

// tx-scoped spies -- separate from any top-level table so assertions on
// e.g. txAdminActionProposal.update don't collide with a top-level read.
const txQueryRaw = vi.fn();
const txAdminActionProposal = { create: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() };
const txAdminActionApproval = { create: vi.fn(), count: vi.fn() };
const txAdminActionAuditLog = { create: vi.fn() };
const txUser = { update: vi.fn() };
const txNotification = { create: vi.fn() };
const txModerationAction = { create: vi.fn() };

const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({
    $queryRaw: txQueryRaw,
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
  REQUIRED_APPROVALS,
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

beforeEach(() => {
  vi.clearAllMocks();
  txQueryRaw.mockResolvedValue([{ id: 100 }]);
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
    txAdminActionApproval.count.mockResolvedValueOnce(1);
    // approveAdminActionProposal() re-fetches the (now one-approval)
    // proposal with its full include set to build the DTO it returns
    // alongside "pending_more" -- a second call to the same mock.
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());

    const result = await approveAdminActionProposal(approverA as never, 100);

    expect(result.kind).toBe("pending_more");
    if (result.kind === "pending_more") expect(result.needed).toBe(REQUIRED_APPROVALS - 1);
    expect(txUser.update).not.toHaveBeenCalled();
    expect(txAdminActionProposal.update).not.toHaveBeenCalled();
  });

  it("executes the suspend exactly once, in the same transaction, the instant the second distinct admin approves", async () => {
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());
    txAdminActionApproval.count.mockResolvedValueOnce(REQUIRED_APPROVALS);
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
      data: { proposalId: 100, event: "EXECUTED", actorUserId: approverB.id },
    });
  });

  it("locks the row with SELECT ... FOR UPDATE before reading the proposal, so concurrent approvals serialize", async () => {
    txAdminActionProposal.findUniqueOrThrow.mockResolvedValueOnce(proposalRow());
    txAdminActionApproval.count.mockResolvedValueOnce(1);
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
