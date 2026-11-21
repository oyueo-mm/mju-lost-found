import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const enforceRateLimit = vi.fn(async () => null as NextResponse | null);
const rateLimitTierFor = vi.fn(async () => "user" as const);
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimit, rateLimitTierFor }));

const requireUserForApi = vi.fn();
const markChatRoomRead = vi.fn();
const markMessageNotificationsReadForChatRoom = vi.fn();
const countUnreadMessagesForUser = vi.fn();
vi.mock("@/lib/chat/http", async () => {
  const response = await import("@/lib/posts/response");
  const chatResponse = await import("@/lib/chat/response");
  return { ...response, ...chatResponse, requireUserForApi };
});
vi.mock("@/lib/chat/service", () => ({ markChatRoomRead, markMessageNotificationsReadForChatRoom, countUnreadMessagesForUser }));

const { POST } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }, id = "1") =>
  POST(new NextRequest(`http://localhost/api/chat/${id}/read`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), params(id));

beforeEach(() => {
  vi.clearAllMocks();
  enforceRateLimit.mockResolvedValue(null);
  requireUserForApi.mockResolvedValue({ user: sessionUser });
  markChatRoomRead.mockResolvedValue({ kind: "ok", data: { lastReadMessageId: 42 } });
  markMessageNotificationsReadForChatRoom.mockResolvedValue({ kind: "ok", data: { count: 1 } });
  countUnreadMessagesForUser.mockResolvedValue(2);
});

describe("POST /api/chat/[id]/read (P-3)", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });
    expect((await post({ upToMessageId: 42 })).status).toBe(401);
    expect(markChatRoomRead).not.toHaveBeenCalled();
  });

  it("refuses a cross-site request before authentication (CSRF)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await post({ upToMessageId: 42 }, { "sec-fetch-site": "cross-site", origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(requireUserForApi).not.toHaveBeenCalled();
    expect(markChatRoomRead).not.toHaveBeenCalled();
  });

  it("refuses a foreign Origin when Sec-Fetch-Site is missing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await post({ upToMessageId: 42 }, { origin: "https://evil.example" })).status).toBe(403);
    expect(markChatRoomRead).not.toHaveBeenCalled();
  });

  it("marks the session user's own cursor up to the shown message and returns the fresh unread total", async () => {
    const res = await post({ upToMessageId: 42, userId: 999 });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(markChatRoomRead).toHaveBeenCalledWith(1, sessionUser.id, 42);
    expect(markMessageNotificationsReadForChatRoom).toHaveBeenCalledWith(1, sessionUser.id, 42);
    expect(json.data).toEqual({ lastReadMessageId: 42, unreadChatCount: 2 });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects a non-participant (another member's room id) without touching notifications", async () => {
    markChatRoomRead.mockResolvedValueOnce({ kind: "forbidden" });
    expect((await post({ upToMessageId: 42 })).status).toBe(403);
    expect(markMessageNotificationsReadForChatRoom).not.toHaveBeenCalled();
    expect(countUnreadMessagesForUser).not.toHaveBeenCalled();
  });

  it("404 for a room that does not exist", async () => {
    markChatRoomRead.mockResolvedValueOnce({ kind: "not_found" });
    expect((await post({ upToMessageId: 42 })).status).toBe(404);
  });

  it.each([
    ["missing id", {}],
    ["zero", { upToMessageId: 0 }],
    ["string", { upToMessageId: "42" }],
    ["fraction", { upToMessageId: 1.5 }],
    ["too large", { upToMessageId: 2147483648 }],
  ])("400 for %s", async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(markChatRoomRead).not.toHaveBeenCalled();
  });

  it("400 for a malformed body and a bad room id", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ upToMessageId: 1 }, undefined, "abc")).status).toBe(400);
    expect(markChatRoomRead).not.toHaveBeenCalled();
  });

  it("honours the rate limit before writing", async () => {
    enforceRateLimit.mockResolvedValueOnce(jsonError(429, "too many"));
    expect((await post({ upToMessageId: 42 })).status).toBe(429);
    expect(markChatRoomRead).not.toHaveBeenCalled();
  });
});
