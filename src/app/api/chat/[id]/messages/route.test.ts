import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const listMessages = vi.fn();
const markChatRoomRead = vi.fn();
const markMessageNotificationsReadForChatRoom = vi.fn();
const countUnreadMessagesForUser = vi.fn();
const sendMessage = vi.fn();
const toggleMessageReaction = vi.fn();

vi.mock("@/lib/chat/http", async () => {
  const response = await import("@/lib/posts/response");
  const chatResponse = await import("@/lib/chat/response");
  return { ...response, ...chatResponse, requireUserForApi };
});
vi.mock("@/lib/chat/service", () => ({
  listMessages,
  markChatRoomRead,
  markMessageNotificationsReadForChatRoom,
  countUnreadMessagesForUser,
  sendMessage,
  toggleMessageReaction,
}));

const { GET, PATCH, POST } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  markChatRoomRead.mockResolvedValue({ kind: "ok", data: { lastReadMessageId: null } });
  markMessageNotificationsReadForChatRoom.mockResolvedValue({ kind: "ok", data: { count: 0 } });
  countUnreadMessagesForUser.mockResolvedValue(0);
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
    expect(markChatRoomRead).not.toHaveBeenCalled();
  });

  it("returns messages and marks them read for an authorized participant", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    listMessages.mockResolvedValueOnce({ kind: "ok", data: { items: [{ id: 1 }], hasMore: false } });

    const res = await GET(new NextRequest("http://localhost/api/chat/1/messages"), params("1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([{ id: 1 }]);
    expect(json.pagination).toEqual({ hasMore: false });
    expect(markChatRoomRead).toHaveBeenCalledWith(1, sessionUser.id);
    expect(markMessageNotificationsReadForChatRoom).toHaveBeenCalledWith(1, sessionUser.id);
  });

  // Phase P-3: the client (ChatThread.tsx) uses this field to push the
  // header/BottomNav badge to the correct value immediately, since
  // router.refresh() alone was confirmed (real browser testing) not to
  // reliably update that shared layout on the same /chat/[id] URL. This
  // is this *authenticated caller's own* total across every room -- see
  // countUnreadMessagesForUser's own scoping -- computed fresh right after
  // the read above, never a value the client could have supplied itself.
  it("includes this user's fresh total unread chat count, computed after marking this room read", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    listMessages.mockResolvedValueOnce({ kind: "ok", data: { items: [{ id: 1 }], hasMore: false } });
    countUnreadMessagesForUser.mockResolvedValueOnce(2);

    const res = await GET(new NextRequest("http://localhost/api/chat/1/messages"), params("1"));
    const json = await res.json();

    expect(json.unreadChatCount).toBe(2);
    expect(countUnreadMessagesForUser).toHaveBeenCalledWith(sessionUser.id);
  });

  it("still returns messages even if marking read fails, with unreadChatCount omitted", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    listMessages.mockResolvedValueOnce({ kind: "ok", data: { items: [], hasMore: false } });
    markChatRoomRead.mockRejectedValueOnce(new Error("db error"));

    const res = await GET(new NextRequest("http://localhost/api/chat/1/messages"), params("1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.unreadChatCount).toBeUndefined();
    expect(countUnreadMessagesForUser).not.toHaveBeenCalled();
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
    expect(sendMessage).toHaveBeenCalledWith(1, sessionUser, "안녕", undefined, undefined);
  });

  // Phase 28-3
  it("forwards imagePath through to sendMessage unchanged", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    sendMessage.mockResolvedValueOnce({ kind: "ok", data: { id: 1, imageUrl: "https://x/y.jpg" } });

    const res = await POST(
      new NextRequest("http://localhost/api/chat/1/messages", {
        method: "POST",
        body: JSON.stringify({ imagePath: "chat/1/y.jpg" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(201);
    expect(sendMessage).toHaveBeenCalledWith(1, sessionUser, "", "chat/1/y.jpg", undefined);
  });

  // Phase D-3
  it("forwards replyToMessageId through to sendMessage unchanged", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    sendMessage.mockResolvedValueOnce({ kind: "ok", data: { id: 2, replyTo: { id: 1 } } });

    const res = await POST(
      new NextRequest("http://localhost/api/chat/1/messages", {
        method: "POST",
        body: JSON.stringify({ content: "네 맞아요", replyToMessageId: 1 }),
      }),
      params("1"),
    );

    expect(res.status).toBe(201);
    expect(sendMessage).toHaveBeenCalledWith(1, sessionUser, "네 맞아요", undefined, 1);
  });

  it("returns 400 when sendMessage rejects an invalid reply target", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    sendMessage.mockResolvedValueOnce({ kind: "invalid_reply" });

    const res = await POST(
      new NextRequest("http://localhost/api/chat/1/messages", {
        method: "POST",
        body: JSON.stringify({ content: "네 맞아요", replyToMessageId: 999 }),
      }),
      params("1"),
    );

    expect(res.status).toBe(400);
  });

  it("rejects a body with neither content nor imagePath", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });

    const res = await POST(
      new NextRequest("http://localhost/api/chat/1/messages", { method: "POST", body: JSON.stringify({}) }),
      params("1"),
    );

    expect(res.status).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("returns 400 when sendMessage rejects an invalid image path", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    sendMessage.mockResolvedValueOnce({ kind: "invalid_image" });

    const res = await POST(
      new NextRequest("http://localhost/api/chat/1/messages", {
        method: "POST",
        body: JSON.stringify({ imagePath: "chat/999/y.jpg" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(400);
  });
});

// Phase D-4: same route file/function as GET/POST above -- see this
// phase's own function-count constraint (no new route).
describe("PATCH /api/chat/[id]/messages", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await PATCH(
      new NextRequest("http://localhost/api/chat/1/messages", {
        method: "PATCH",
        body: JSON.stringify({ messageId: 1, emoji: "👍" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(401);
    expect(toggleMessageReaction).not.toHaveBeenCalled();
  });

  it("rejects an emoji outside the fixed allowed set", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });

    const res = await PATCH(
      new NextRequest("http://localhost/api/chat/1/messages", {
        method: "PATCH",
        body: JSON.stringify({ messageId: 1, emoji: "🍕" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(400);
    expect(toggleMessageReaction).not.toHaveBeenCalled();
  });

  it("toggles the reaction as the authenticated session user, not any userId in the body", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    toggleMessageReaction.mockResolvedValueOnce({
      kind: "ok",
      data: { messageId: 1, reactions: [{ emoji: "👍", count: 1, reactedByMe: true }] },
    });

    const res = await PATCH(
      new NextRequest("http://localhost/api/chat/1/messages", {
        method: "PATCH",
        body: JSON.stringify({ messageId: 1, emoji: "👍", userId: "someone-else" }),
      }),
      params("1"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.reactions).toEqual([{ emoji: "👍", count: 1, reactedByMe: true }]);
    expect(toggleMessageReaction).toHaveBeenCalledWith(1, 1, "👍", sessionUser);
  });

  it("rejects a room the user isn't a participant of (A's room ID known by B)", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    toggleMessageReaction.mockResolvedValueOnce({ kind: "forbidden" });

    const res = await PATCH(
      new NextRequest("http://localhost/api/chat/1/messages", {
        method: "PATCH",
        body: JSON.stringify({ messageId: 1, emoji: "👍" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(403);
  });

  it("returns 400 when toggleMessageReaction rejects a messageId from a different room", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    toggleMessageReaction.mockResolvedValueOnce({ kind: "invalid_reaction" });

    const res = await PATCH(
      new NextRequest("http://localhost/api/chat/1/messages", {
        method: "PATCH",
        body: JSON.stringify({ messageId: 999, emoji: "👍" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(400);
  });

  it("rejects a missing messageId", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });

    const res = await PATCH(
      new NextRequest("http://localhost/api/chat/1/messages", {
        method: "PATCH",
        body: JSON.stringify({ emoji: "👍" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(400);
    expect(toggleMessageReaction).not.toHaveBeenCalled();
  });
});
