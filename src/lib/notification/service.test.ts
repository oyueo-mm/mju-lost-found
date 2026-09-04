import { beforeEach, describe, expect, it, vi } from "vitest";

const notification = {
  findMany: vi.fn(),
  count: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
};

vi.mock("@/lib/db/prisma", () => ({ prisma: { notification } }));
vi.mock("@/generated/prisma/client", () => ({
  // The concrete string values here don't matter for these tests (rows
  // are mocked with plain string "types" already, see notificationRow()
  // below); this just satisfies the module's import.
}));

const {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} = await import("./service");

function notificationRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    userId: 1,
    type: "MATCH",
    title: "새로운 매칭이 성립되었습니다",
    content: "매칭이 확정되어 상대방과 연락할 수 있습니다.",
    relatedType: "match",
    relatedId: 10,
    isRead: false,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listNotifications", () => {
  it("scopes the query to the given userId", async () => {
    notification.findMany.mockResolvedValueOnce([]);
    notification.count.mockResolvedValueOnce(0);

    await listNotifications(1, { page: 1, limit: 20 });

    expect(notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1 } }),
    );
    expect(notification.count).toHaveBeenCalledWith({ where: { userId: 1 } });
  });

  it("orders by createdAt desc, id desc", async () => {
    notification.findMany.mockResolvedValueOnce([]);
    notification.count.mockResolvedValueOnce(0);

    await listNotifications(1, { page: 1, limit: 20 });

    expect(notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    );
  });

  it("converts the Prisma enum type to the legacy lowercase string", async () => {
    notification.findMany.mockResolvedValueOnce([notificationRow({ type: "MATCH" })]);
    notification.count.mockResolvedValueOnce(1);

    const result = await listNotifications(1, { page: 1, limit: 20 });

    expect(result.items[0].type).toBe("match");
  });

  it("computes totalPages from total/limit, minimum 1", async () => {
    notification.findMany.mockResolvedValueOnce([]);
    notification.count.mockResolvedValueOnce(0);

    const result = await listNotifications(1, { page: 1, limit: 20 });

    expect(result.totalPages).toBe(1);
  });

  it("applies skip based on the requested page", async () => {
    notification.findMany.mockResolvedValueOnce([]);
    notification.count.mockResolvedValueOnce(0);

    await listNotifications(1, { page: 3, limit: 20 });

    expect(notification.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 40, take: 20 }));
  });
});

describe("getUnreadNotificationCount", () => {
  it("counts only the given user's unread notifications", async () => {
    notification.count.mockResolvedValueOnce(3);

    const count = await getUnreadNotificationCount(1);

    expect(count).toBe(3);
    expect(notification.count).toHaveBeenCalledWith({ where: { userId: 1, isRead: false } });
  });
});

describe("markNotificationAsRead", () => {
  it("returns not_found for a nonexistent notification", async () => {
    notification.findUnique.mockResolvedValueOnce(null);

    const result = await markNotificationAsRead(999, 1);

    expect(result).toEqual({ kind: "not_found" });
    expect(notification.updateMany).not.toHaveBeenCalled();
  });

  it("rejects marking another user's notification as read", async () => {
    notification.findUnique.mockResolvedValueOnce(notificationRow({ userId: 2 }));

    const result = await markNotificationAsRead(1, 1);

    expect(result).toEqual({ kind: "forbidden" });
    expect(notification.updateMany).not.toHaveBeenCalled();
  });

  it("marks the owner's own notification as read, scoped by id AND userId", async () => {
    notification.findUnique.mockResolvedValueOnce(notificationRow({ userId: 1, isRead: false }));
    notification.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await markNotificationAsRead(1, 1);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.isRead).toBe(true);
    expect(notification.updateMany).toHaveBeenCalledWith({
      where: { id: 1, userId: 1 },
      data: { isRead: true },
    });
  });

  it("is idempotent -- re-marking an already-read notification succeeds without another write", async () => {
    notification.findUnique.mockResolvedValueOnce(notificationRow({ userId: 1, isRead: true }));

    const result = await markNotificationAsRead(1, 1);

    expect(result.kind).toBe("ok");
    expect(notification.updateMany).not.toHaveBeenCalled();
  });
});

describe("markAllNotificationsAsRead", () => {
  it("updates only the given user's unread notifications via a single bulk update", async () => {
    notification.updateMany.mockResolvedValueOnce({ count: 5 });

    const count = await markAllNotificationsAsRead(1);

    expect(count).toBe(5);
    expect(notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 1, isRead: false },
      data: { isRead: true },
    });
  });
});
