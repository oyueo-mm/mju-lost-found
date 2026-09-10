import { describe, expect, it, vi } from "vitest";

import { fanOutToAdmins, fanOutToOrganizationManagers } from "./adminFanout";

function fakeTx() {
  return {
    user: { findMany: vi.fn() },
    organizationMember: { findMany: vi.fn() },
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

describe("fanOutToOrganizationManagers (Phase 12-11 §9/§10)", () => {
  it("notifies every current LEADER/ADMIN of the organization, excluding the inquirer", async () => {
    const tx = fakeTx();
    tx.organizationMember.findMany.mockResolvedValueOnce([{ userId: 1 }, { userId: 2 }]);

    await fanOutToOrganizationManagers(tx as never, {
      organizationId: 10,
      excludeUserId: 99,
      type: "ORGANIZATION_CHAT_RECEIVED" as never,
      title: "새로운 단체 문의가 도착했습니다",
      content: "문의자님이 단체에 문의를 남겼습니다.",
      relatedType: "organization_chat_room",
      relatedId: 500,
    });

    expect(tx.organizationMember.findMany).toHaveBeenCalledWith({
      where: { organizationId: 10, role: { in: ["LEADER", "ADMIN"] }, userId: { not: 99 } },
      select: { userId: true },
    });
    expect(tx.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 1,
          type: "ORGANIZATION_CHAT_RECEIVED",
          title: "새로운 단체 문의가 도착했습니다",
          content: "문의자님이 단체에 문의를 남겼습니다.",
          relatedType: "organization_chat_room",
          relatedId: 500,
        },
        {
          userId: 2,
          type: "ORGANIZATION_CHAT_RECEIVED",
          title: "새로운 단체 문의가 도착했습니다",
          content: "문의자님이 단체에 문의를 남겼습니다.",
          relatedType: "organization_chat_room",
          relatedId: 500,
        },
      ],
      skipDuplicates: true,
    });
  });

  // A plain MEMBER is never a query target here -- role IN (LEADER, ADMIN)
  // is part of the DB query itself, so this test locks in that the query
  // shape excludes MEMBER, not just that the mocked result happens to.
  it("never queries for or notifies a plain MEMBER (role filter is DB-level)", async () => {
    const tx = fakeTx();
    tx.organizationMember.findMany.mockResolvedValueOnce([]);

    await fanOutToOrganizationManagers(tx as never, {
      organizationId: 10,
      excludeUserId: 99,
      type: "ORGANIZATION_CHAT_RECEIVED" as never,
      title: "t",
      content: "c",
      relatedType: "organization_chat_room",
      relatedId: 1,
    });

    const where = tx.organizationMember.findMany.mock.calls[0][0].where;
    expect(where.role).toEqual({ in: ["LEADER", "ADMIN"] });
    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });

  it("does nothing (no insert) when the organization has no managers other than the excluded inquirer", async () => {
    const tx = fakeTx();
    tx.organizationMember.findMany.mockResolvedValueOnce([]);

    await fanOutToOrganizationManagers(tx as never, {
      organizationId: 10,
      excludeUserId: 99,
      type: "ORGANIZATION_CHAT_RECEIVED" as never,
      title: "t",
      content: "c",
      relatedType: "organization_chat_room",
      relatedId: 1,
    });

    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });
});
