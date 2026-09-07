import { beforeEach, describe, expect, it, vi } from "vitest";

const user = { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() };
// Phase F-2: suspend now runs inside a $transaction alongside a
// notification.create -- mocked the same interactive-callback shape as
// comment/service.test.ts's own $transaction mock, handing the tx object
// back as { user, notification } (both point at the same spies this file
// already asserts against, so every pre-F-2 assertion on user.update stays
// valid unchanged).
const notification = { create: vi.fn() };
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ user, notification }));

vi.mock("@/lib/db/prisma", () => ({ prisma: { user, notification, $transaction } }));
// isAdmin() is a one-line `return user.isAdmin` in moderation/service.ts,
// but that module also pulls in report/service.ts and report/targets.ts --
// mocked wholesale here (same convention other route/service tests in this
// project already use for a same-domain collaborator) so this test file
// only ever depends on what it actually exercises.
vi.mock("@/lib/moderation/service", () => ({ isAdmin: (u: { isAdmin: boolean }) => u.isAdmin }));
// Same convention as comment/service.test.ts's own mock of this module --
// only the one enum member this file actually exercises is stubbed.
vi.mock("@/generated/prisma/client", () => ({
  NotificationType: { USER_SUSPENDED: "USER_SUSPENDED" },
}));

const { listUsersForAdmin, updateUserByAdmin } = await import("./users");

const admin = { id: 1, isAdmin: true };
const nonAdmin = { id: 2, isAdmin: false };

const baseRow = {
  id: 5,
  email: "target@mju.ac.kr",
  nickname: "대상유저",
  isAdmin: false,
  isSuspended: false,
  suspendedUntil: null,
  createdAt: new Date("2026-01-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listUsersForAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const result = await listUsersForAdmin(nonAdmin as never, { page: 1, limit: 20 });
    expect(result).toEqual({ kind: "forbidden" });
    expect(user.findMany).not.toHaveBeenCalled();
  });

  it("lists users with pagination", async () => {
    user.findMany.mockResolvedValueOnce([baseRow]);
    user.count.mockResolvedValueOnce(1);

    const result = await listUsersForAdmin(admin as never, { page: 1, limit: 20 });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].id).toBe(5);
      expect(result.data.total).toBe(1);
    }
  });

  it("derives currentlySuspended from isCurrentlySuspended(), not the raw isSuspended flag", async () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    user.findMany.mockResolvedValueOnce([
      { ...baseRow, id: 1, isSuspended: false, suspendedUntil: null }, // never suspended
      { ...baseRow, id: 2, isSuspended: true, suspendedUntil: null }, // permanent
      { ...baseRow, id: 3, isSuspended: true, suspendedUntil: future }, // active timed
      { ...baseRow, id: 4, isSuspended: true, suspendedUntil: past }, // expired timed
    ]);
    user.count.mockResolvedValueOnce(4);

    const result = await listUsersForAdmin(admin as never, { page: 1, limit: 20 });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const byId = Object.fromEntries(result.data.items.map((u) => [u.id, u]));
    expect(byId[1].currentlySuspended).toBe(false);
    expect(byId[2].currentlySuspended).toBe(true);
    expect(byId[3].currentlySuspended).toBe(true);
    // The expired-timed user's raw isSuspended flag stays true (sticky,
    // audit-preserving, see auth/suspension.ts) but currentlySuspended must
    // reflect that the suspension has actually lapsed.
    expect(byId[4].isSuspended).toBe(true);
    expect(byId[4].currentlySuspended).toBe(false);
  });

  it("searches by email/nickname when q is given", async () => {
    user.findMany.mockResolvedValueOnce([]);
    user.count.mockResolvedValueOnce(0);

    await listUsersForAdmin(admin as never, { q: "target", page: 1, limit: 20 });

    expect(user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { email: { contains: "target", mode: "insensitive" } },
            { nickname: { contains: "target", mode: "insensitive" } },
          ],
        },
      }),
    );
  });
});

describe("updateUserByAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const result = await updateUserByAdmin(nonAdmin as never, 5, "promote");
    expect(result).toEqual({ kind: "forbidden" });
    expect(user.update).not.toHaveBeenCalled();
  });

  it("blocks an admin from demoting themselves", async () => {
    const result = await updateUserByAdmin(admin as never, admin.id, "demote");
    expect(result).toEqual({ kind: "self" });
    expect(user.update).not.toHaveBeenCalled();
  });

  it("blocks an admin from suspending themselves", async () => {
    const result = await updateUserByAdmin(admin as never, admin.id, "suspend");
    expect(result).toEqual({ kind: "self" });
    expect(user.update).not.toHaveBeenCalled();
  });

  it("allows an admin to promote themselves (harmless, stays allowed)", async () => {
    user.findUnique.mockResolvedValueOnce({ ...baseRow, id: admin.id });
    user.update.mockResolvedValueOnce({ ...baseRow, id: admin.id, isAdmin: true });

    const result = await updateUserByAdmin(admin as never, admin.id, "promote");

    expect(result.kind).toBe("ok");
    expect(user.update).toHaveBeenCalledWith({
      where: { id: admin.id },
      data: { isAdmin: true },
      include: { suspendedBy: { select: { nickname: true } } },
    });
  });

  it("returns not_found for a nonexistent target user", async () => {
    user.findUnique.mockResolvedValueOnce(null);
    const result = await updateUserByAdmin(admin as never, 999, "promote");
    expect(result).toEqual({ kind: "not_found" });
  });

  it("promotes a user to admin", async () => {
    user.findUnique.mockResolvedValueOnce(baseRow);
    user.update.mockResolvedValueOnce({ ...baseRow, isAdmin: true });

    const result = await updateUserByAdmin(admin as never, 5, "promote");

    expect(user.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { isAdmin: true },
      include: { suspendedBy: { select: { nickname: true } } },
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.isAdmin).toBe(true);
  });

  it("demotes another admin", async () => {
    user.findUnique.mockResolvedValueOnce({ ...baseRow, isAdmin: true });
    user.update.mockResolvedValueOnce({ ...baseRow, isAdmin: false });

    const result = await updateUserByAdmin(admin as never, 5, "demote");

    expect(user.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { isAdmin: false },
      include: { suspendedBy: { select: { nickname: true } } },
    });
    expect(result.kind).toBe("ok");
  });

  it("suspends permanently when no duration is given", async () => {
    user.findUnique.mockResolvedValueOnce(baseRow);
    user.update.mockResolvedValueOnce({ ...baseRow, isSuspended: true, suspendedUntil: null });

    await updateUserByAdmin(admin as never, 5, "suspend");

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(user.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { isSuspended: true, suspendedUntil: null, suspendedByUserId: admin.id },
      include: { suspendedBy: { select: { nickname: true } } },
    });
    expect(notification.create).toHaveBeenCalledWith({
      data: {
        userId: 5,
        type: "USER_SUSPENDED",
        title: "계정 정지 안내",
        content: "계정이 영구 정지되었습니다.",
        relatedType: null,
        relatedId: null,
      },
    });
  });

  // Phase F-2: 1일/3일/7일/30일 all go through the exact same code path --
  // one representative duration (7) covers the branch; the option *list*
  // itself (moderation/schema.ts's SUSPEND_DURATION_DAY_OPTIONS) is what
  // actually changed, not this function's logic.
  it("suspends for a fixed duration when suspendDurationDays is given, with a matching notification", async () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(start);
    try {
      user.findUnique.mockResolvedValueOnce(baseRow);
      user.update.mockResolvedValueOnce({ ...baseRow, isSuspended: true });

      await updateUserByAdmin(admin as never, 5, "suspend", 7);

      const call = user.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 5 });
      expect(call.data.isSuspended).toBe(true);
      expect(call.data.suspendedUntil).toEqual(new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000));
      expect(notification.create).toHaveBeenCalledWith({
        data: {
          userId: 5,
          type: "USER_SUSPENDED",
          title: "계정 정지 안내",
          content: "계정이 7일 정지되었습니다.",
          relatedType: null,
          relatedId: null,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("suspends for 1 day (shortest new preset)", async () => {
    user.findUnique.mockResolvedValueOnce(baseRow);
    user.update.mockResolvedValueOnce({ ...baseRow, isSuspended: true });

    await updateUserByAdmin(admin as never, 5, "suspend", 1);

    expect(notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: "계정이 1일 정지되었습니다." }) }),
    );
  });

  it("suspends for a custom duration outside the fixed presets (e.g. 45 days)", async () => {
    user.findUnique.mockResolvedValueOnce(baseRow);
    user.update.mockResolvedValueOnce({ ...baseRow, isSuspended: true });

    await updateUserByAdmin(admin as never, 5, "suspend", 45);

    const call = user.update.mock.calls[0][0];
    expect(call.data.suspendedUntil).toBeInstanceOf(Date);
    expect(notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: "계정이 45일 정지되었습니다." }) }),
    );
  });

  // Phase H-3
  it("exposes suspendedByNickname on the returned DTO from the suspendedBy include", async () => {
    user.findUnique.mockResolvedValueOnce(baseRow);
    user.update.mockResolvedValueOnce({
      ...baseRow,
      isSuspended: true,
      suspendedByUserId: admin.id,
      suspendedBy: { nickname: "관리자닉네임" },
    });

    const result = await updateUserByAdmin(admin as never, 5, "suspend");

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.suspendedByNickname).toBe("관리자닉네임");
  });

  it("does not create a notification (or use $transaction) for promote/demote/unsuspend", async () => {
    user.findUnique.mockResolvedValueOnce(baseRow);
    user.update.mockResolvedValueOnce({ ...baseRow, isAdmin: true });

    await updateUserByAdmin(admin as never, 5, "promote");

    expect($transaction).not.toHaveBeenCalled();
    expect(notification.create).not.toHaveBeenCalled();
  });

  it("unsuspends a user, clearing suspendedUntil", async () => {
    user.findUnique.mockResolvedValueOnce({ ...baseRow, isSuspended: true, suspendedUntil: new Date() });
    user.update.mockResolvedValueOnce({ ...baseRow, isSuspended: false, suspendedUntil: null });

    await updateUserByAdmin(admin as never, 5, "unsuspend");

    expect(user.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { isSuspended: false, suspendedUntil: null, suspendedByUserId: null },
      include: { suspendedBy: { select: { nickname: true } } },
    });
  });
});
