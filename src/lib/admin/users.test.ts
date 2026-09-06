import { beforeEach, describe, expect, it, vi } from "vitest";

const user = { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() };

vi.mock("@/lib/db/prisma", () => ({ prisma: { user } }));
// isAdmin() is a one-line `return user.isAdmin` in moderation/service.ts,
// but that module also pulls in report/service.ts and report/targets.ts --
// mocked wholesale here (same convention other route/service tests in this
// project already use for a same-domain collaborator) so this test file
// only ever depends on what it actually exercises.
vi.mock("@/lib/moderation/service", () => ({ isAdmin: (u: { isAdmin: boolean }) => u.isAdmin }));

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
    expect(user.update).toHaveBeenCalledWith({ where: { id: admin.id }, data: { isAdmin: true } });
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

    expect(user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { isAdmin: true } });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.isAdmin).toBe(true);
  });

  it("demotes another admin", async () => {
    user.findUnique.mockResolvedValueOnce({ ...baseRow, isAdmin: true });
    user.update.mockResolvedValueOnce({ ...baseRow, isAdmin: false });

    const result = await updateUserByAdmin(admin as never, 5, "demote");

    expect(user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { isAdmin: false } });
    expect(result.kind).toBe("ok");
  });

  it("suspends permanently when no duration is given", async () => {
    user.findUnique.mockResolvedValueOnce(baseRow);
    user.update.mockResolvedValueOnce({ ...baseRow, isSuspended: true, suspendedUntil: null });

    await updateUserByAdmin(admin as never, 5, "suspend");

    expect(user.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { isSuspended: true, suspendedUntil: null },
    });
  });

  it("suspends for a fixed duration when suspendDurationDays is given", async () => {
    user.findUnique.mockResolvedValueOnce(baseRow);
    user.update.mockResolvedValueOnce({ ...baseRow, isSuspended: true });

    await updateUserByAdmin(admin as never, 5, "suspend", 7);

    const call = user.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 5 });
    expect(call.data.isSuspended).toBe(true);
    expect(call.data.suspendedUntil).toBeInstanceOf(Date);
  });

  it("unsuspends a user, clearing suspendedUntil", async () => {
    user.findUnique.mockResolvedValueOnce({ ...baseRow, isSuspended: true, suspendedUntil: new Date() });
    user.update.mockResolvedValueOnce({ ...baseRow, isSuspended: false, suspendedUntil: null });

    await updateUserByAdmin(admin as never, 5, "unsuspend");

    expect(user.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { isSuspended: false, suspendedUntil: null },
    });
  });
});
