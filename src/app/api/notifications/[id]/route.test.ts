import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const markNotificationAsRead = vi.fn();

vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireUserForApi };
});
vi.mock("@/lib/notification/service", () => ({ markNotificationAsRead }));

const { PATCH } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/notifications/[id]", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await PATCH(new NextRequest("http://localhost/api/notifications/1", { method: "PATCH" }), params("1"));

    expect(res.status).toBe(401);
    expect(markNotificationAsRead).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent notification", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    markNotificationAsRead.mockResolvedValueOnce({ kind: "not_found" });

    const res = await PATCH(new NextRequest("http://localhost/api/notifications/999", { method: "PATCH" }), params("999"));

    expect(res.status).toBe(404);
  });

  it("rejects marking another user's notification", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    markNotificationAsRead.mockResolvedValueOnce({ kind: "forbidden" });

    const res = await PATCH(new NextRequest("http://localhost/api/notifications/1", { method: "PATCH" }), params("1"));

    expect(res.status).toBe(403);
  });

  it("marks the notification read for the owner", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    markNotificationAsRead.mockResolvedValueOnce({ kind: "ok", data: { id: 1, isRead: true } });

    const res = await PATCH(new NextRequest("http://localhost/api/notifications/1", { method: "PATCH" }), params("1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.isRead).toBe(true);
    expect(markNotificationAsRead).toHaveBeenCalledWith(1, sessionUser.id);
  });
});
