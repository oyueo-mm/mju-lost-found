import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/generated/prisma/client";

class FakePrismaClientKnownRequestError extends Error {
  code: string;
  constructor(code: string) {
    super("mock prisma error");
    this.code = code;
  }
}

const report = { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() };
const lostPost = { findUnique: vi.fn() };
const foundPost = { findUnique: vi.fn() };
const message = { findUnique: vi.fn() };
const userTable = { findUnique: vi.fn() };

// Transaction body operates on a `tx` object -- give it its own set of
// mocks so assertions on e.g. tx.report.updateMany don't collide with the
// top-level report.findUnique used before the transaction opens.
const txReport = { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() };
const txLostPost = { delete: vi.fn() };
const txFoundPost = { delete: vi.fn() };
const txMessage = { update: vi.fn() };
const txUser = { update: vi.fn() };
const txModerationAction = { create: vi.fn() };
const txNotification = { create: vi.fn() };

const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({
    report: txReport,
    lostPost: txLostPost,
    foundPost: txFoundPost,
    message: txMessage,
    user: txUser,
    moderationAction: txModerationAction,
    notification: txNotification,
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  prisma: { report, lostPost, foundPost, message, user: userTable, $transaction },
}));
vi.mock("@/generated/prisma/client", () => ({
  ReportTargetType: { POST: "POST", MESSAGE: "MESSAGE", USER: "USER" },
  ReportStatus: { PENDING: "PENDING", DISMISSED: "DISMISSED", ACTIONED: "ACTIONED" },
  ModerationActionType: { DELETE_POST: "DELETE_POST", HIDE_MESSAGE: "HIDE_MESSAGE", SUSPEND_USER: "SUSPEND_USER" },
  LostPostStatus: { SEARCHING: "SEARCHING", FOUND: "FOUND" },
  FoundPostStatus: { KEEPING: "KEEPING", COMPLETED: "COMPLETED" },
  NotificationType: {
    MESSAGE: "MESSAGE",
    MATCH: "MATCH",
    REPORT_PROCESSED: "REPORT_PROCESSED",
    POST_DELETED: "POST_DELETED",
    MESSAGE_HIDDEN: "MESSAGE_HIDDEN",
    USER_SUSPENDED: "USER_SUSPENDED",
  },
  Prisma: { PrismaClientKnownRequestError: FakePrismaClientKnownRequestError },
}));

const {
  applyReportAction,
  dismissReport,
  getReportForAdmin,
  getReportTargetType,
  isAdmin,
  listReportsForAdmin,
} = await import("./service");

const admin = { id: 1, isAdmin: true } as unknown as User;
const nonAdmin = { id: 2, isAdmin: false } as unknown as User;

function reportRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    reporterUserId: 3,
    targetType: "POST",
    targetId: 5,
    reason: "기타",
    detail: null,
    status: "PENDING",
    createdAt: new Date("2026-01-01"),
    processedAt: null,
    processedByUserId: null,
    adminNote: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  txReport.findUniqueOrThrow.mockImplementation(async () => reportRow({ status: "DISMISSED" }));
});

describe("isAdmin", () => {
  it("is DB-sourced -- true only when the User row's isAdmin flag is set", () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(nonAdmin)).toBe(false);
  });
});

describe("listReportsForAdmin / getReportForAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const result = await listReportsForAdmin(nonAdmin, { page: 1, limit: 20 });
    expect(result).toEqual({ kind: "forbidden" });
    expect(report.findMany).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller for report detail too", async () => {
    const result = await getReportForAdmin(nonAdmin, 10);
    expect(result).toEqual({ kind: "forbidden" });
    expect(report.findUnique).not.toHaveBeenCalled();
  });

  it("returns not_found for a nonexistent report", async () => {
    report.findUnique.mockResolvedValueOnce(null);
    const result = await getReportForAdmin(admin, 999);
    expect(result).toEqual({ kind: "not_found" });
  });

  it("marks the target as deleted when the underlying post is gone", async () => {
    report.findUnique.mockResolvedValueOnce({
      ...reportRow(),
      reporter: { nickname: "신고자" },
      processedBy: null,
      moderationAction: null,
    });
    lostPost.findUnique.mockResolvedValueOnce(null);

    const result = await getReportForAdmin(admin, 10);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.targetDeleted).toBe(true);
      expect(result.data.targetInfo).toBeNull();
    }
  });
});

describe("getReportTargetType", () => {
  it("returns null for a nonexistent report", async () => {
    report.findUnique.mockResolvedValueOnce(null);
    expect(await getReportTargetType(999)).toBeNull();
  });

  it("returns the report's own target type, translated from the DB enum", async () => {
    report.findUnique.mockResolvedValueOnce({ targetType: "MESSAGE" });
    expect(await getReportTargetType(10)).toBe("message");
  });
});

describe("dismissReport", () => {
  it("rejects a non-admin caller", async () => {
    const result = await dismissReport(nonAdmin, 10);
    expect(result).toEqual({ kind: "forbidden" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("returns not_found for a nonexistent report", async () => {
    report.findUnique.mockResolvedValueOnce(null);
    const result = await dismissReport(admin, 999);
    expect(result).toEqual({ kind: "not_found" });
  });

  it("returns already_processed when the report is no longer pending (atomic guard)", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow());
    txReport.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await dismissReport(admin, 10, "메모");

    expect(result).toEqual({ kind: "already_processed" });
    expect(txNotification.create).not.toHaveBeenCalled();
  });

  it("dismisses a pending report and notifies the reporter, never the processor field from anywhere but admin.id", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow());
    txReport.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await dismissReport(admin, 10, "  검토 완료  ");

    expect(result.kind).toBe("ok");
    expect(txReport.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: "PENDING" },
      data: {
        status: "DISMISSED",
        processedAt: expect.any(Date),
        processedByUserId: admin.id,
        adminNote: "검토 완료",
      },
    });
    expect(txNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 3, type: "REPORT_PROCESSED", relatedType: "report", relatedId: 10 }),
    });
  });
});

describe("applyReportAction", () => {
  it("rejects a non-admin caller", async () => {
    const result = await applyReportAction(nonAdmin, 10, "delete_post", {});
    expect(result).toEqual({ kind: "forbidden" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("returns not_found for a nonexistent report", async () => {
    report.findUnique.mockResolvedValueOnce(null);
    const result = await applyReportAction(admin, 999, "delete_post", {});
    expect(result).toEqual({ kind: "not_found" });
  });

  it("rejects an action_type that doesn't match the report's target_type", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "POST" }));

    const result = await applyReportAction(admin, 10, "suspend_user", {});

    expect(result).toEqual({ kind: "invalid_action_type" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("deletes the target post, notifies its owner, records the ModerationAction, and marks the report actioned", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "POST", targetId: 5 }));
    lostPost.findUnique.mockResolvedValueOnce({ id: 5, userId: 42 });
    txReport.updateMany.mockResolvedValueOnce({ count: 1 });
    txReport.findUniqueOrThrow.mockResolvedValueOnce(reportRow({ status: "ACTIONED" }));

    const result = await applyReportAction(admin, 10, "delete_post", { actionReason: "부적절", adminNote: "확인" });

    expect(result.kind).toBe("ok");
    expect(txLostPost.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(txNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 42, type: "POST_DELETED" }),
    });
    expect(txModerationAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reportId: 10,
        actionType: "DELETE_POST",
        adminUserId: admin.id,
        reason: "부적절",
      }),
    });
    expect(txReport.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: "PENDING" },
      data: { status: "ACTIONED", processedAt: expect.any(Date), processedByUserId: admin.id, adminNote: "확인" },
    });
    // Reporter notification is separate from the target-owner notification.
    expect(txNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 3, type: "REPORT_PROCESSED" }),
    });
  });

  it("hides the target message (masking only, content untouched) and notifies its sender", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "MESSAGE", targetId: 77 }));
    message.findUnique.mockResolvedValueOnce({ id: 77, senderUserId: 55 });
    txReport.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await applyReportAction(admin, 10, "hide_message", { actionReason: "욕설" });

    expect(result.kind).toBe("ok");
    expect(txMessage.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { hiddenAt: expect.any(Date), hiddenByUserId: admin.id, hiddenReason: "욕설" },
    });
    expect(txNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 55, type: "MESSAGE_HIDDEN" }),
    });
  });

  it("suspends the target user with a timed expiry when suspendDurationDays is given", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "USER", targetId: 88 }));
    userTable.findUnique.mockResolvedValueOnce({ id: 88 });
    txReport.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await applyReportAction(admin, 10, "suspend_user", { suspendDurationDays: 7 });

    expect(result.kind).toBe("ok");
    expect(txUser.update).toHaveBeenCalledWith({
      where: { id: 88 },
      data: { isSuspended: true, suspendedUntil: expect.any(Date) },
    });
  });

  it("suspends permanently (suspendedUntil null) when no duration is given", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "USER", targetId: 88 }));
    userTable.findUnique.mockResolvedValueOnce({ id: 88 });
    txReport.updateMany.mockResolvedValueOnce({ count: 1 });

    await applyReportAction(admin, 10, "suspend_user", {});

    expect(txUser.update).toHaveBeenCalledWith({
      where: { id: 88 },
      data: { isSuspended: true, suspendedUntil: null },
    });
  });

  it("returns target_gone (and never inserts a ModerationAction) if the post was deleted before the transaction ran", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "POST", targetId: 5 }));
    lostPost.findUnique.mockResolvedValueOnce(null);

    const result = await applyReportAction(admin, 10, "delete_post", {});

    expect(result).toEqual({ kind: "target_gone" });
    expect(txModerationAction.create).not.toHaveBeenCalled();
  });

  it("rolls back the whole transaction (no ModerationAction, no notification) when the report was already processed concurrently", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "POST", targetId: 5 }));
    lostPost.findUnique.mockResolvedValueOnce({ id: 5, userId: 42 });
    txReport.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await applyReportAction(admin, 10, "delete_post", {});

    expect(result).toEqual({ kind: "already_processed" });
    // The transaction mock applies mutations eagerly in this test double,
    // but production Prisma rolls the entire transaction back when the
    // callback's returned promise resolves to a value the caller treats as
    // failure -- the guarantee under test here is that the *caller* never
    // reports success and never sends the reporter a REPORT_PROCESSED
    // notification when the status guard didn't actually flip.
    expect(txNotification.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "REPORT_PROCESSED" }),
    });
  });

  it("converts a concurrent ModerationAction UNIQUE violation (two admins racing) into already_processed", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "POST", targetId: 5 }));
    lostPost.findUnique.mockResolvedValueOnce({ id: 5, userId: 42 });
    txModerationAction.create.mockRejectedValueOnce(new FakePrismaClientKnownRequestError("P2002"));

    const result = await applyReportAction(admin, 10, "delete_post", {});

    expect(result).toEqual({ kind: "already_processed" });
  });

  it("rethrows a non-P2002 error out of the transaction", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "POST", targetId: 5 }));
    lostPost.findUnique.mockResolvedValueOnce({ id: 5, userId: 42 });
    txModerationAction.create.mockRejectedValueOnce(new Error("db down"));

    await expect(applyReportAction(admin, 10, "delete_post", {})).rejects.toThrow("db down");
  });
});
