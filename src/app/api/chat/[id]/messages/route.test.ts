import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const listMessages = vi.fn();
const markMessagesAsRead = vi.fn();
const markMessageNotificationsReadForChatRoom = vi.fn();
const sendMessage = vi.fn();

vi.mock("@/lib/chat/http", async () => {
  const response = await import("@/lib/posts/response");
  const chatResponse = await import("@/lib/chat/response");
  return { ...response, ...chatResponse, requireUserForApi };
});
vi.mock("@/lib/chat/service", () => ({
  listMessages,
  markMessagesAsRead,
  markMessageNotificationsReadForChatRoom,
  sendMessage,
}));

const { GET, POST } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  markMessagesAsRead.mockResolvedValue({ kind: "ok", data: { count: 0 } });
  markMessageNotificationsReadForChatRoom.mockResolvedValue({ kind: "ok", data: { count: 0 } });
});

describe("GET /api/chat/[id]/messages", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await GET(new NextRequest("http://localhost/api/chat/1/messages"), params("1"));

    expect(res.status).toBe(401);
    expect(listMessages).not.toHaveBeenCalled();
  });

  it("rejects a user who isn't a participant (A's room ID known by B)", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    listMessages.mockResolvedValueOnce({ kind: "forbidden" });

    const res = await GET(new NextRequest("http://localhost/api/chat/1/messages"), params("1"));

    expect(res.status).toBe(403);
    expect(markMessagesAsRead).not.toHaveBeenCalled();
  });

  it("returns messages and marks them read for an authorized participant", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    listMessages.mockResolvedValueOnce({ kind: "ok", data: { items: [{ id: 1 }], hasMore: false } });

    const res = await GET(new NextRequest("http://localhost/api/chat/1/messages"), params("1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([{ id: 1 }]);
    expect(json.pagination).toEqual({ hasMore: false });
    expect(markMessagesAsRead).toHaveBeenCalledWith(1, sessionUser.id);
    expect(markMessageNotificationsReadForChatRoom).toHaveBeenCalledWith(1, sessionUser.id);
  });

  it("still returns messages even if marking read fails", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    listMessages.mockResolvedValueOnce({ kind: "ok", data: { items: [], hasMore: false } });
    markMessagesAsRead.mockRejectedValueOnce(new Error("db error"));

    const res = await GET(new NextRequest("http://localhost/api/chat/1/messages"), params("1"));

    expect(res.status).toBe(200);
  });

  it("passes the before cursor through", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    listMessages.mockResolvedValueOnce({ kind: "ok", data: { items: [], hasMore: false } });

    await GET(new NextRequest("http://localhost/api/chat/1/messages?before=50"), params("1"));

    expect(listMessages).toHaveBeenCalledWith(1, sessionUser.id, 50);
  });
});

describe("POST /api/chat/[id]/messages", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await POST(
      new NextRequest("http://localhost/api/chat/1/messages", {
        method: "POST",
        body: JSON.stringify({ content: "안녕" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(401);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("rejects a blank message body", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });

    const res = await POST(
      new NextRequest("http://localhost/api/chat/1/messages", {
        method: "POST",
        body: JSON.stringify({ content: "   " }),
      }),
      params("1"),
    );

    expect(res.status).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("rejects sending to a room the user isn't a participant of (A's room ID known by B)", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    sendMessage.mockResolvedValueOnce({ kind: "forbidden" });

    const res = await POST(
      new NextRequest("http://localhost/api/chat/1/messages", {
        method: "POST",
        body: JSON.stringify({ content: "안녕" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(403);
  });

  it("sends the message as the authenticated session user, not any userId in the body", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    sendMessage.mockResolvedValueOnce({ kind: "ok", data: { id: 1, content: "안녕" } });

    const res = await POST(
      new NextRequest("http://localhost/api/chat/1/messages", {
        method: "POST",
        body: JSON.stringify({ content: "안녕", userId: "someone-else" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(201);
    expect(sendMessage).toHaveBeenCalledWith(1, sessionUser, "안녕");
  });
});
