import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const getUnreadNotificationCount = vi.fn();

vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireUserForApi };
});
vi.mock("@/lib/notification/service", () => ({ getUnreadNotificationCount }));

const { GET } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/notifications/unread-count", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(getUnreadNotificationCount).not.toHaveBeenCalled();
  });

  it("returns the current user's unread count", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getUnreadNotificationCount.mockResolvedValueOnce(3);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ count: 3 });
    expect(getUnreadNotificationCount).toHaveBeenCalledWith(1);
  });
});
