import { beforeEach, describe, expect, it, vi } from "vitest";

import { ACTIVE_RECIPIENT_WHERE, notifyUser } from "./recipients";

const tx = { user: { count: vi.fn() }, notification: { create: vi.fn() } };
const data = { userId: 7, type: "COMMENT_REPLY" as const, title: "t", content: "c" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notifyUser", () => {
  it("creates the notification for an active user, exactly as tx.notification.create would", async () => {
    tx.user.count.mockResolvedValueOnce(1);

    const created = await notifyUser(tx as never, { data });

    expect(created).toBe(true);
    expect(tx.user.count).toHaveBeenCalledWith({ where: { id: 7, deletedAt: null } });
    expect(tx.notification.create).toHaveBeenCalledWith({ data });
  });

  it("creates nothing for a deactivated user", async () => {
    tx.user.count.mockResolvedValueOnce(0);

    const created = await notifyUser(tx as never, { data });

    expect(created).toBe(false);
    expect(tx.notification.create).not.toHaveBeenCalled();
  });
});

describe("ACTIVE_RECIPIENT_WHERE", () => {
  it("excludes deactivated users (User.deletedAt set)", () => {
    expect(ACTIVE_RECIPIENT_WHERE).toEqual({ deletedAt: null });
  });
});
