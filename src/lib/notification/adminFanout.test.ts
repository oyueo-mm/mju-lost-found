import { describe, expect, it, vi } from "vitest";

import { fanOutToAdmins } from "./adminFanout";

function fakeTx() {
  return {
    user: { findMany: vi.fn() },
    notification: { createMany: vi.fn() },
  };
}

describe("fanOutToAdmins (Phase 12-9 §2)", () => {
  it("notifies every current Platform Admin, never a regular user", async () => {
    const tx = fakeTx();
    tx.user.findMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

    await fanOutToAdmins(tx as never, {
      type: "REPORT_RECEIVED" as never,
      title: "새 신고가 접수되었습니다",
      content: "게시글 신고: 기타",
      relatedType: "report",
      relatedId: 77,
    });

    expect(tx.user.findMany).toHaveBeenCalledWith({ where: { isAdmin: true }, select: { id: true } });
    expect(tx.notification.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 1, type: "REPORT_RECEIVED", title: "새 신고가 접수되었습니다", content: "게시글 신고: 기타", relatedType: "report", relatedId: 77 },
        { userId: 2, type: "REPORT_RECEIVED", title: "새 신고가 접수되었습니다", content: "게시글 신고: 기타", relatedType: "report", relatedId: 77 },
      ],
      skipDuplicates: true,
    });
  });

  it("does nothing (no query, no insert) when there are no admins", async () => {
    const tx = fakeTx();
    tx.user.findMany.mockResolvedValueOnce([]);

    await fanOutToAdmins(tx as never, {
      type: "FEEDBACK_RECEIVED" as never,
      title: "t",
      content: "c",
      relatedType: "feedback",
      relatedId: 1,
    });

    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });

  // Notification's own @@unique([userId, type, relatedType, relatedId]) is
  // the real backstop against duplicate notifications -- skipDuplicates
  // here is defensive, this test just locks in that it's actually passed.
  it("passes skipDuplicates: true to guard against a duplicate fan-out", async () => {
    const tx = fakeTx();
    tx.user.findMany.mockResolvedValueOnce([{ id: 1 }]);

    await fanOutToAdmins(tx as never, {
      type: "SUSPENSION_APPEAL_RECEIVED" as never,
      title: "t",
      content: "c",
      relatedType: "suspension_appeal",
      relatedId: 5,
    });

    const call = tx.notification.createMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
  });
});
