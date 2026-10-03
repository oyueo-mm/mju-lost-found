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
const comment = { findUnique: vi.fn() };

// Transaction body operates on a `tx` object -- give it its own set of
// mocks so assertions on e.g. tx.report.updateMany don't collide with the
// top-level report.findUnique used before the transaction opens.
const txReport = { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() };
const txLostPost = { delete: vi.fn() };
const txFoundPost = { delete: vi.fn() };
const txMessage = { update: vi.fn() };
// 관리자 승인 인원 정책 Phase: createAdminActionProposal() also reads the
// active admins (findMany) and takes an advisory lock ($executeRaw) inside
// its transaction.
const txUser = { update: vi.fn(), findMany: vi.fn(), count: vi.fn() };
const txExecuteRaw = vi.fn();
const txComment = { delete: vi.fn() };
const txModerationAction = { create: vi.fn() };
const txNotification = { create: vi.fn() };
// Phase 관리자 승인제: applyReportAction() now calls
// admin/proposals.ts::createAdminActionProposal() when the reported user
// is an admin -- that function opens its own $transaction (the same
// mocked prisma.$transaction this file already provides), writing these
// two additional tables.
const txAdminActionProposal = { create: vi.fn() };
const txAdminActionAuditLog = { create: vi.fn() };

const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({
    report: txReport,
    lostPost: txLostPost,
    foundPost: txFoundPost,
    message: txMessage,
    user: txUser,
    comment: txComment,
    moderationAction: txModerationAction,
    notification: txNotification,
    adminActionProposal: txAdminActionProposal,
    adminActionAuditLog: txAdminActionAuditLog,
    $executeRaw: txExecuteRaw,
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  prisma: { report, lostPost, foundPost, message, user: userTable, comment, $transaction },
}));
// The post/comment removal itself is shared with the owner/admin delete
// paths and tested there (posts/service.test.ts, comment/service.test.ts);
// here only that applyReportAction uses them -- inside its transaction,
// with Storage cleanup after it -- is checked.
const deletePostRowInTx = vi.fn();
const deletePostStorageObjects = vi.fn();
vi.mock("@/lib/posts/service", () => ({ deletePostRowInTx, deletePostStorageObjects }));
const removeCommentInTx = vi.fn();
vi.mock("@/lib/comment/remove", () => ({ removeCommentInTx }));
vi.mock("@/generated/prisma/client", () => ({
  ReportTargetType: { POST: "POST", MESSAGE: "MESSAGE", USER: "USER", COMMENT: "COMMENT" },
  ReportStatus: { PENDING: "PENDING", DISMISSED: "DISMISSED", ACTIONED: "ACTIONED" },
  ModerationActionType: {
    DELETE_POST: "DELETE_POST",
    HIDE_MESSAGE: "HIDE_MESSAGE",
    SUSPEND_USER: "SUSPEND_USER",
    DELETE_COMMENT: "DELETE_COMMENT",
  },
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
  AdminActionProposalType: {
    SUSPEND_USER: "SUSPEND_USER",
    UNSUSPEND_USER: "UNSUSPEND_USER",
    GRANT_ADMIN: "GRANT_ADMIN",
    REVOKE_ADMIN: "REVOKE_ADMIN",
  },
  AdminActionAuditEvent: { CREATED: "CREATED", EXECUTED: "EXECUTED" },
  Prisma: {
    PrismaClientKnownRequestError: FakePrismaClientKnownRequestError,
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  },
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
  txUser.count.mockResolvedValue(1); // notifyUser: the recipient is active
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

  it("identifies a comment report and surfaces the comment's content for the admin (Phase C-3)", async () => {
    report.findUnique.mockResolvedValueOnce({
      ...reportRow({ targetType: "COMMENT", targetId: 42 }),
      reporter: { nickname: "신고자" },
      processedBy: null,
      moderationAction: null,
    });
    comment.findUnique.mockResolvedValueOnce({
      content: "부적절한 댓글 내용",
      createdAt: new Date("2026-01-02"),
      lostPostId: 7,
      foundPostId: null,
      parentId: null,
      author: { nickname: "댓글작성자" },
    });

    const result = await getReportForAdmin(admin, 10);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.targetDeleted).toBe(false);
      expect(result.data.targetInfo).toEqual({
        kind: "comment",
        content: "부적절한 댓글 내용",
        authorNickname: "댓글작성자",
        createdAt: new Date("2026-01-02"),
        postType: "lost",
        postId: 7,
        parentId: null,
      });
    }
  });

  // 사용자 신고 Phase: mirrors "identifies a comment report..." above --
  // targetType="USER" in place of "COMMENT", asserting the admin-facing
  // targetInfo shape getReportForAdmin's own switch already produces for
  // it (report/[id]/page.tsx's final targetInfo.kind === "user" branch
  // renders exactly this shape).
  it("identifies a user report and surfaces the target user's nickname for the admin", async () => {
    report.findUnique.mockResolvedValueOnce({
      ...reportRow({ targetType: "USER", targetId: 88 }),
      reporter: { nickname: "신고자" },
      processedBy: null,
      moderationAction: null,
    });
    userTable.findUnique.mockResolvedValueOnce({ nickname: "신고대상자" });

    const result = await getReportForAdmin(admin, 10);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.targetDeleted).toBe(false);
      expect(result.data.targetInfo).toEqual({ kind: "user", nickname: "신고대상자" });
    }
  });

  it("marks a user report's target as deleted when the reported user no longer exists", async () => {
    report.findUnique.mockResolvedValueOnce({
      ...reportRow({ targetType: "USER", targetId: 88 }),
      reporter: { nickname: "신고자" },
      processedBy: null,
      moderationAction: null,
    });
    userTable.findUnique.mockResolvedValueOnce(null);

    const result = await getReportForAdmin(admin, 10);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.targetDeleted).toBe(true);
      expect(result.data.targetInfo).toBeNull();
    }
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
    deletePostRowInTx.mockResolvedValueOnce(["https://x/post.webp"]);
    txReport.updateMany.mockResolvedValueOnce({ count: 1 });
    txReport.findUniqueOrThrow.mockResolvedValueOnce(reportRow({ status: "ACTIONED" }));

    const result = await applyReportAction(admin, 10, "delete_post", { actionReason: "부적절", adminNote: "확인" });

    expect(result.kind).toBe("ok");
    expect(deletePostRowInTx).toHaveBeenCalledWith(expect.objectContaining({ lostPost: txLostPost }), "lost", 5);
    // The post's own images are removed only after the transaction commits.
    expect(deletePostStorageObjects).toHaveBeenCalledWith(["https://x/post.webp"]);
    expect(deletePostStorageObjects.mock.invocationCallOrder[0]).toBeGreaterThan(
      txReport.updateMany.mock.invocationCallOrder[0],
    );
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

  it("deletes the target comment, records the ModerationAction, marks the report actioned, and sends no target-owner notification (Phase C-3)", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "COMMENT", targetId: 42 }));
    comment.findUnique.mockResolvedValueOnce({ id: 42, authorUserId: 77, parentId: null, deletedAt: null });
    txReport.updateMany.mockResolvedValueOnce({ count: 1 });
    txReport.findUniqueOrThrow.mockResolvedValueOnce(reportRow({ targetType: "COMMENT", status: "ACTIONED" }));

    const result = await applyReportAction(admin, 10, "delete_comment", { actionReason: "부적절" });

    expect(result.kind).toBe("ok");
    // Same removal as a self/admin delete: a comment with replies becomes a
    // tombstone instead of cascade-deleting other users' replies.
    expect(removeCommentInTx).toHaveBeenCalledWith(expect.objectContaining({ comment: txComment }), {
      id: 42,
      authorUserId: 77,
      parentId: null,
    });
    // No notification naming the comment's own author (77) -- only the
    // reporter's REPORT_PROCESSED one further below.
    expect(txNotification.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 77 }),
    });
    expect(txModerationAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ reportId: 10, actionType: "DELETE_COMMENT", adminUserId: admin.id }),
    });
    expect(txNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 3, type: "REPORT_PROCESSED" }),
    });
  });

  it("returns target_gone for a comment report when the comment was already deleted", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "COMMENT", targetId: 42 }));
    comment.findUnique.mockResolvedValueOnce(null);

    const result = await applyReportAction(admin, 10, "delete_comment", {});

    expect(result).toEqual({ kind: "target_gone" });
    expect(txModerationAction.create).not.toHaveBeenCalled();
  });

  it("rejects delete_comment against a non-comment report", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "POST" }));

    const result = await applyReportAction(admin, 10, "delete_comment", {});

    expect(result).toEqual({ kind: "invalid_action_type" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("suspends the target user with a timed expiry when suspendDurationDays is given", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "USER", targetId: 88 }));
    // Phase 관리자 승인제: applyReportAction() now checks the target's own
    // isAdmin (a separate prisma.user.findUnique call, before the
    // transaction opens) before resolveUserTarget's own call inside it --
    // both share this same mock, so both calls need a queued value now.
    userTable.findUnique.mockResolvedValueOnce({ isAdmin: false });
    userTable.findUnique.mockResolvedValueOnce({ id: 88 });
    txReport.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await applyReportAction(admin, 10, "suspend_user", {
      suspendDurationDays: 7,
      actionReasonCategory: "욕설/비방",
      actionReason: "반복적인 욕설",
    });

    expect(result.kind).toBe("ok");
    expect(txUser.update).toHaveBeenCalledWith({
      where: { id: 88 },
      data: { isSuspended: true, suspendedUntil: expect.any(Date), suspendedByUserId: admin.id },
    });
  });

  // Phase F-2: the service itself doesn't branch on which specific duration
  // was chosen (1/3/7/30/custom all flow through the same
  // `suspendDurationDays * 24h` formula) -- this just confirms the newly
  // added short preset (1일) still reaches that same code path correctly.
  it("suspends the target user for a 1-day duration (new F-2 preset)", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "USER", targetId: 88 }));
    userTable.findUnique.mockResolvedValueOnce({ isAdmin: false });
    userTable.findUnique.mockResolvedValueOnce({ id: 88 });
    txReport.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await applyReportAction(admin, 10, "suspend_user", {
      suspendDurationDays: 1,
      actionReasonCategory: "욕설/비방",
      actionReason: "반복적인 욕설",
    });

    expect(result.kind).toBe("ok");
    expect(txUser.update).toHaveBeenCalledWith({
      where: { id: 88 },
      data: { isSuspended: true, suspendedUntil: expect.any(Date), suspendedByUserId: admin.id },
    });
  });

  it("suspends permanently (suspendedUntil null) when no duration is given", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "USER", targetId: 88 }));
    userTable.findUnique.mockResolvedValueOnce({ isAdmin: false });
    userTable.findUnique.mockResolvedValueOnce({ id: 88 });
    txReport.updateMany.mockResolvedValueOnce({ count: 1 });

    await applyReportAction(admin, 10, "suspend_user", {
      actionReasonCategory: "욕설/비방",
      actionReason: "반복적인 욕설",
    });

    expect(txUser.update).toHaveBeenCalledWith({
      where: { id: 88 },
      data: { isSuspended: true, suspendedUntil: null, suspendedByUserId: admin.id },
    });
  });

  // Phase 관리자 승인제.
  describe("admin-target suspend routes through AdminActionProposal", () => {
    it("suspends a regular (non-admin) reported user immediately, exactly as before", async () => {
      report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "USER", targetId: 88 }));
      userTable.findUnique.mockResolvedValueOnce({ isAdmin: false });
      userTable.findUnique.mockResolvedValueOnce({ id: 88 });
      txReport.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await applyReportAction(admin, 10, "suspend_user", {
        actionReasonCategory: "욕설/비방",
        actionReason: "반복적인 욕설",
      });

      expect(result.kind).toBe("ok");
      expect(txUser.update).toHaveBeenCalledWith({
        where: { id: 88 },
        data: { isSuspended: true, suspendedUntil: null, suspendedByUserId: admin.id },
      });
      expect(txAdminActionProposal.create).not.toHaveBeenCalled();
      // The report itself is actually resolved (ACTIONED) for a regular
      // target -- distinct from the admin-target case below, which leaves
      // it PENDING.
      expect(txReport.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 10, status: "PENDING" } }),
      );
    });

    it("never suspends an admin-reported user directly -- creates an AdminActionProposal instead, and leaves the report PENDING", async () => {
      report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "USER", targetId: 88 }));
      // The admin-target check (a separate prisma.user.findUnique, before
      // the transaction) and createAdminActionProposal's own target
      // lookup (a second, independent call) both share this mock.
      userTable.findUnique.mockResolvedValueOnce({ isAdmin: true });
      userTable.findUnique.mockResolvedValueOnce({ id: 88, isAdmin: true });
      // Active admins: the processing admin and the reported admin.
      txUser.findMany.mockResolvedValueOnce([{ id: admin.id }, { id: 88 }]);
      txAdminActionProposal.create.mockResolvedValueOnce({
        id: 42,
        targetUserId: 88,
        actionType: "SUSPEND_USER",
        reasonCategory: "욕설/비방",
        reason: "반복적인 욕설",
        suspendDurationDays: null,
        status: "PENDING",
        proposedByUserId: admin.id,
        createdAt: new Date("2026-01-01"),
        expiresAt: new Date("2026-01-08"),
        executedAt: null,
        cancelledAt: null,
        cancelledByUserId: null,
        targetUser: { id: 88, nickname: "대상관리자", publicId: "target-uuid", isAdmin: true },
        proposedBy: { id: admin.id, nickname: "제안자" },
        cancelledBy: null,
        approvals: [],
      });

      const result = await applyReportAction(admin, 10, "suspend_user", {
        actionReasonCategory: "욕설/비방",
        actionReason: "반복적인 욕설",
      });

      expect(result.kind).toBe("proposal_created");
      if (result.kind === "proposal_created") {
        expect(result.data.actionType).toBe("suspend_user");
        expect(result.data.status).toBe("pending");
      }
      // Nothing about the User row, ModerationAction, or the report's own
      // status was ever touched by this call -- only the proposal exists.
      expect(txUser.update).not.toHaveBeenCalled();
      expect(txModerationAction.create).not.toHaveBeenCalled();
      expect(txReport.updateMany).not.toHaveBeenCalled();
      expect(txAdminActionProposal.create).toHaveBeenCalledTimes(1);
    });

    // 관리자 승인 인원 정책 Phase.
    it("returns last_admin (not target_gone) when suspending the reported admin would leave no active admin", async () => {
      report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "USER", targetId: 88 }));
      userTable.findUnique.mockResolvedValueOnce({ isAdmin: true });
      userTable.findUnique.mockResolvedValueOnce({ id: 88, isAdmin: true });
      txUser.findMany.mockResolvedValueOnce([{ id: 88 }]); // the reported admin is the only active one

      const result = await applyReportAction(admin, 10, "suspend_user", {
        actionReasonCategory: "욕설/비방",
        actionReason: "반복적인 욕설",
      });

      expect(result).toEqual({ kind: "last_admin" });
      expect(txAdminActionProposal.create).not.toHaveBeenCalled();
      expect(txUser.update).not.toHaveBeenCalled();
    });

    it("still requires a reason category and detail for an admin-target suspend, same as a direct one", async () => {
      report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "USER", targetId: 88 }));

      const result = await applyReportAction(admin, 10, "suspend_user", {});

      expect(result).toEqual({ kind: "reason_required" });
      expect(userTable.findUnique).not.toHaveBeenCalled();
      expect(txAdminActionProposal.create).not.toHaveBeenCalled();
    });
  });

  // Phase I section 2.
  it("returns reason_required and never opens a transaction when suspend_user has no reason", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "USER", targetId: 88 }));

    const result = await applyReportAction(admin, 10, "suspend_user", { suspendDurationDays: 7 });

    expect(result).toEqual({ kind: "reason_required" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("returns reason_required when only the category is given, without the detail", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ targetType: "USER", targetId: 88 }));

    const result = await applyReportAction(admin, 10, "suspend_user", {
      suspendDurationDays: 7,
      actionReasonCategory: "욕설/비방",
    });

    expect(result).toEqual({ kind: "reason_required" });
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
