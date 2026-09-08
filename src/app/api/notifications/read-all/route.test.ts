import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const markAllNotificationsAsRead = vi.fn();
const getUnreadNotificationCount = vi.fn();

vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireUserForApi };
});
vi.mock("@/lib/notification/service", () => ({ markAllNotificationsAsRead, getUnreadNotificationCount }));

const { POST } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };

beforeEach(() => {
  vi.clearAllMocks();
  getUnreadNotificationCount.mockResolvedValue(0);
});

describe("POST /api/notifications/read-all", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await POST();

    expect(res.status).toBe(401);
    expect(markAllNotificationsAsRead).not.toHaveBeenCalled();
  });

  it("marks all of the current user's unread notifications as read", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    markAllNotificationsAsRead.mockResolvedValueOnce(4);

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ count: 4 });
    expect(markAllNotificationsAsRead).toHaveBeenCalledWith(1);
  });

  // Phase P-3: MarkAllReadButton.tsx dispatches this to the header bell
  // badge directly -- same fix as the PATCH/DELETE routes.
  it("includes this user's fresh unreadNotificationCount (0 right after marking all read)", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    markAllNotificationsAsRead.mockResolvedValueOnce(4);
    getUnreadNotificationCount.mockResolvedValueOnce(0);

    const res = await POST();
    const json = await res.json();

    expect(json.unreadNotificationCount).toBe(0);
    expect(getUnreadNotificationCount).toHaveBeenCalledWith(1);
  });
});
