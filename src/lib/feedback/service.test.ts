import { beforeEach, describe, expect, it, vi } from "vitest";

const feedback = {
  create: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  update: vi.fn(),
  // Phase 반영 완료 잠금: the actual status-changing write in
  // updateFeedbackStatus() is now an updateMany conditioned on
  // `status: { not: COMPLETED }` (see that function's own comment on why),
  // not a plain update -- feedback.update is still used for the
  // already-completed idempotent-note-only branch.
  updateMany: vi.fn(),
};
// Phase 12-9 §2: createFeedback() now wraps its insert in $transaction and
// calls fanOutToAdmins() -- see report/service.test.ts's own identical
// comment for why both are mocked this way.
const fanOutToAdmins = vi.fn();
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ feedback }));

vi.mock("@/lib/db/prisma", () => ({ prisma: { feedback, $transaction } }));
vi.mock("@/lib/moderation/service", () => ({ isAdmin: (u: { isAdmin: boolean }) => u.isAdmin }));
vi.mock("@/lib/notification/adminFanout", () => ({ fanOutToAdmins }));
vi.mock("@/generated/prisma/client", () => ({
  FeedbackCategory: { FEATURE_REQUEST: "FEATURE_REQUEST", INCONVENIENCE: "INCONVENIENCE", BUG: "BUG", OTHER: "OTHER" },
  FeedbackStatus: {
    RECEIVED: "RECEIVED",
    IN_REVIEW: "IN_REVIEW",
    PLANNED: "PLANNED",
    COMPLETED: "COMPLETED",
    NOT_PLANNED: "NOT_PLANNED",
  },
  NotificationType: { FEEDBACK_RECEIVED: "FEEDBACK_RECEIVED" },
}));

const { createFeedback, getMyFeedback, listFeedbackForAdmin, getFeedbackForAdmin, updateFeedbackStatus } =
  await import("./service");

const admin = { id: 1, isAdmin: true };
const nonAdmin = { id: 2, isAdmin: false };
const otherUser = { id: 3, isAdmin: false };

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 10,
  category: "FEATURE_REQUEST",
  title: "검색 필터가 있었으면 좋겠어요",
  content: "검색 결과가 너무 많아서 필터가 필요합니다.",
  status: "RECEIVED",
  adminNote: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  user: { id: 2, nickname: "닉네임", publicId: "pub-2" },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createFeedback", () => {
  it("attaches the caller's own userId, never a client-supplied one", async () => {
    feedback.create.mockResolvedValueOnce(row());

    const result = await createFeedback(nonAdmin as never, {
      category: "feature_request",
      title: "검색 필터가 있었으면 좋겠어요",
      content: "검색 결과가 너무 많아서 필터가 필요합니다.",
    });

    expect(result.kind).toBe("ok");
    expect(feedback.create).toHaveBeenCalledWith({
      data: {
        userId: 2,
        category: "FEATURE_REQUEST",
        title: "검색 필터가 있었으면 좋겠어요",
        content: "검색 결과가 너무 많아서 필터가 필요합니다.",
      },
    });
  });

  it("returns a DTO without adminNote/author -- those never reach the submitting user", async () => {
    feedback.create.mockResolvedValueOnce(row());
    const result = await createFeedback(nonAdmin as never, {
      category: "bug",
      title: "t",
      content: "c",
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data).not.toHaveProperty("adminNote");
      expect(result.data).not.toHaveProperty("author");
    }
  });

  // Phase 12-9 §2: every successful feedback submission fans out to
  // admins -- see report/service.test.ts's own identical-shape test.
  it("fans out a FEEDBACK_RECEIVED notification to admins on successful creation", async () => {
    feedback.create.mockResolvedValueOnce(row({ id: 88 }));

    await createFeedback(nonAdmin as never, { category: "bug", title: "t", content: "c" });

    expect(fanOutToAdmins).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "FEEDBACK_RECEIVED", relatedType: "feedback", relatedId: 88 }),
    );
  });
});

describe("getMyFeedback", () => {
  it("scopes the query to the caller's own userId", async () => {
    feedback.findMany.mockResolvedValueOnce([row()]);

    await getMyFeedback(nonAdmin as never);

    expect(feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 2 } }),
    );
  });

  it("never returns another user's feedback (query is scoped, not filtered after the fact)", async () => {
    // The mock only ever returns what the (scoped) query asked for -- this
    // asserts the caller's own id is what's actually sent to the DB, which
    // is what makes cross-user leakage structurally impossible here.
    feedback.findMany.mockResolvedValueOnce([]);
    await getMyFeedback(otherUser as never);
    expect(feedback.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 3 } }));
  });
});

describe("listFeedbackForAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const result = await listFeedbackForAdmin(nonAdmin as never, { page: 1, limit: 20 });
    expect(result).toEqual({ kind: "forbidden" });
    expect(feedback.findMany).not.toHaveBeenCalled();
  });

  it("lists feedback with pagination and author info", async () => {
    feedback.findMany.mockResolvedValueOnce([row()]);
    feedback.count.mockResolvedValueOnce(1);

    const result = await listFeedbackForAdmin(admin as never, { page: 1, limit: 20 });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].author.nickname).toBe("닉네임");
      expect(result.data.total).toBe(1);
    }
  });

  it("filters by status when given", async () => {
    feedback.findMany.mockResolvedValueOnce([]);
    feedback.count.mockResolvedValueOnce(0);

    await listFeedbackForAdmin(admin as never, { status: "in_review", page: 1, limit: 20 });

    expect(feedback.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "IN_REVIEW" } }));
  });

  it("omits the status filter (전체) when none is given", async () => {
    feedback.findMany.mockResolvedValueOnce([]);
    feedback.count.mockResolvedValueOnce(0);

    await listFeedbackForAdmin(admin as never, { page: 1, limit: 20 });

    expect(feedback.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});

describe("getFeedbackForAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const result = await getFeedbackForAdmin(nonAdmin as never, 10);
    expect(result).toEqual({ kind: "forbidden" });
    expect(feedback.findUnique).not.toHaveBeenCalled();
  });

  it("returns not_found for a nonexistent feedback", async () => {
    feedback.findUnique.mockResolvedValueOnce(null);
    const result = await getFeedbackForAdmin(admin as never, 999);
    expect(result).toEqual({ kind: "not_found" });
  });

  it("returns the full admin DTO including adminNote and author", async () => {
    feedback.findUnique.mockResolvedValueOnce(row({ adminNote: "다음 스프린트에 반영 예정" }));
    const result = await getFeedbackForAdmin(admin as never, 10);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.adminNote).toBe("다음 스프린트에 반영 예정");
      expect(result.data.author).toEqual({ id: 2, nickname: "닉네임", publicId: "pub-2" });
    }
  });
});

describe("updateFeedbackStatus", () => {
  it("rejects a non-admin caller", async () => {
    const result = await updateFeedbackStatus(nonAdmin as never, 10, { status: "in_review" });
    expect(result).toEqual({ kind: "forbidden" });
    expect(feedback.update).not.toHaveBeenCalled();
  });

  it("returns not_found for a nonexistent feedback", async () => {
    feedback.findUnique.mockResolvedValueOnce(null);
    const result = await updateFeedbackStatus(admin as never, 999, { status: "in_review" });
    expect(result).toEqual({ kind: "not_found" });
  });

  it("updates only status when adminNote is omitted -- an existing note is preserved", async () => {
    feedback.findUnique.mockResolvedValueOnce(row({ adminNote: "기존 메모" }));
    feedback.updateMany.mockResolvedValueOnce({ count: 1 });
    feedback.findUniqueOrThrow.mockResolvedValueOnce(row({ status: "in_review", adminNote: "기존 메모" }));

    await updateFeedbackStatus(admin as never, 10, { status: "in_review" });

    expect(feedback.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: { not: "COMPLETED" } },
      data: { status: "IN_REVIEW" },
    });
  });

  it("updates status and adminNote together when both are given", async () => {
    feedback.findUnique.mockResolvedValueOnce(row());
    feedback.updateMany.mockResolvedValueOnce({ count: 1 });
    feedback.findUniqueOrThrow.mockResolvedValueOnce(row({ status: "planned", adminNote: "다음 스프린트 반영" }));

    await updateFeedbackStatus(admin as never, 10, { status: "planned", adminNote: "다음 스프린트 반영" });

    expect(feedback.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: { not: "COMPLETED" } },
      data: { status: "PLANNED", adminNote: "다음 스프린트 반영" },
    });
  });

  it("clears adminNote when explicitly given an empty string", async () => {
    feedback.findUnique.mockResolvedValueOnce(row({ adminNote: "기존 메모" }));
    feedback.updateMany.mockResolvedValueOnce({ count: 1 });
    feedback.findUniqueOrThrow.mockResolvedValueOnce(row({ adminNote: null }));

    await updateFeedbackStatus(admin as never, 10, { status: "received", adminNote: "" });

    expect(feedback.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: { not: "COMPLETED" } },
      data: { status: "RECEIVED", adminNote: null },
    });
  });

  // Phase 반영 완료 잠금.
  describe("completed is terminal", () => {
    it("rejects changing a completed feedback to any other status", async () => {
      feedback.findUnique.mockResolvedValueOnce(row({ status: "COMPLETED" }));

      const result = await updateFeedbackStatus(admin as never, 10, { status: "in_review" });

      expect(result).toEqual({ kind: "locked" });
      expect(feedback.update).not.toHaveBeenCalled();
      expect(feedback.updateMany).not.toHaveBeenCalled();
    });

    it("allows the same completed status again as an idempotent no-op, still applying adminNote", async () => {
      feedback.findUnique.mockResolvedValueOnce(row({ status: "COMPLETED", adminNote: "기존 메모" }));
      feedback.update.mockResolvedValueOnce(row({ status: "completed", adminNote: "갱신된 메모" }));

      const result = await updateFeedbackStatus(admin as never, 10, { status: "completed", adminNote: "갱신된 메모" });

      expect(feedback.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { adminNote: "갱신된 메모" },
        include: expect.anything(),
      });
      expect(feedback.updateMany).not.toHaveBeenCalled();
      expect(result.kind).toBe("ok");
    });

    it("reports locked (not a silent success) when a concurrent request already completed it between read and write", async () => {
      feedback.findUnique.mockResolvedValueOnce(row({ status: "in_review" }));
      // The UPDATE's own WHERE guard is what actually catches the race --
      // simulated here by a concurrent completion having already flipped
      // the row, so this admin's own `status: { not: COMPLETED }` update
      // matches zero rows.
      feedback.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await updateFeedbackStatus(admin as never, 10, { status: "not_planned" });

      expect(result).toEqual({ kind: "locked" });
    });
  });
});
