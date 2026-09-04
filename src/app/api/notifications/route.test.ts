import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const listNotifications = vi.fn();

vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireUserForApi };
});
vi.mock("@/lib/notification/service", () => ({ listNotifications }));

const { GET } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/notifications", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await GET(new NextRequest("http://localhost/api/notifications"));

    expect(res.status).toBe(401);
    expect(listNotifications).not.toHaveBeenCalled();
  });

  it("returns the current user's notifications with a pagination envelope", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    listNotifications.mockResolvedValueOnce({
      items: [{ id: 1 }],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });

    const res = await GET(new NextRequest("http://localhost/api/notifications"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([{ id: 1 }]);
    expect(json.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(listNotifications).toHaveBeenCalledWith(1, { page: 1, limit: 20 });
  });
});
