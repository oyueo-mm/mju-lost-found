import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const getOrCreateChatRoomForMatch = vi.fn();
const getOrCreateDirectChatRoom = vi.fn();
const listChatRoomsForUser = vi.fn();

vi.mock("@/lib/chat/http", async () => {
  const response = await import("@/lib/posts/response");
  const chatResponse = await import("@/lib/chat/response");
  return { ...response, ...chatResponse, requireUserForApi };
});
vi.mock("@/lib/chat/service", () => ({ getOrCreateChatRoomForMatch, getOrCreateDirectChatRoom, listChatRoomsForUser }));

const { GET, POST } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/chat", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(listChatRoomsForUser).not.toHaveBeenCalled();
  });

  it("returns the current user's chat rooms", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    listChatRoomsForUser.mockResolvedValueOnce([{ id: 1 }]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([{ id: 1 }]);
    expect(listChatRoomsForUser).toHaveBeenCalledWith(1);
  });
});

describe("POST /api/chat", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await POST(
      new NextRequest("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ matchId: 1 }) }),
    );

    expect(res.status).toBe(401);
    expect(getOrCreateChatRoomForMatch).not.toHaveBeenCalled();
  });

  it("rejects an invalid body", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });

    const res = await POST(
      new NextRequest("http://localhost/api/chat", { method: "POST", body: JSON.stringify({}) }),
    );

    expect(res.status).toBe(400);
    expect(getOrCreateChatRoomForMatch).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent match", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getOrCreateChatRoomForMatch.mockResolvedValueOnce({ kind: "match_not_found" });

    const res = await POST(
      new NextRequest("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ matchId: 999 }) }),
    );

    expect(res.status).toBe(404);
  });

  it("rejects a match the user isn't party to", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getOrCreateChatRoomForMatch.mockResolvedValueOnce({ kind: "forbidden" });

    const res = await POST(
      new NextRequest("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ matchId: 1 }) }),
    );

    expect(res.status).toBe(403);
  });

  it("creates/returns the chat room for a valid match", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getOrCreateChatRoomForMatch.mockResolvedValueOnce({ kind: "ok", data: { id: 100 } });

    const res = await POST(
      new NextRequest("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ matchId: 1 }) }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.id).toBe(100);
    expect(getOrCreateChatRoomForMatch).toHaveBeenCalledWith(1, sessionUser.id);
  });

  // Phase 10: the { postType, postId } body shape creates/returns a
  // direct room instead -- dispatched by which keys the body has, not a
  // separate route.
  describe("direct chat body ({ postType, postId })", () => {
    it("rejects an unauthenticated request", async () => {
      requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

      const res = await POST(
        new NextRequest("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({ postType: "lost", postId: 1 }),
        }),
      );

      expect(res.status).toBe(401);
      expect(getOrCreateDirectChatRoom).not.toHaveBeenCalled();
    });

    it("creates/returns the direct chat room for a valid post", async () => {
      requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
      getOrCreateDirectChatRoom.mockResolvedValueOnce({ kind: "ok", data: { id: 200, roomType: "direct" } });

      const res = await POST(
        new NextRequest("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({ postType: "lost", postId: 1 }),
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.data.id).toBe(200);
      expect(getOrCreateDirectChatRoom).toHaveBeenCalledWith("lost", 1, sessionUser);
      expect(getOrCreateChatRoomForMatch).not.toHaveBeenCalled();
    });

    it("returns 404 for a nonexistent/deleted post", async () => {
      requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
      getOrCreateDirectChatRoom.mockResolvedValueOnce({ kind: "not_found" });

      const res = await POST(
        new NextRequest("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({ postType: "lost", postId: 999 }),
        }),
      );

      expect(res.status).toBe(404);
    });

    it("returns 403 for the post's own author (self-chat)", async () => {
      requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
      getOrCreateDirectChatRoom.mockResolvedValueOnce({ kind: "forbidden", reason: "self" });

      const res = await POST(
        new NextRequest("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({ postType: "lost", postId: 1 }),
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toBe("자기 자신의 게시물에는 채팅을 시작할 수 없습니다.");
    });

    it("returns 403 for a suspended requester", async () => {
      requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
      getOrCreateDirectChatRoom.mockResolvedValueOnce({ kind: "forbidden", reason: "suspended" });

      const res = await POST(
        new NextRequest("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({ postType: "lost", postId: 1 }),
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toBe("정지된 계정은 이 기능을 사용할 수 없습니다.");
    });

    it("rejects a body with neither matchId nor postType/postId", async () => {
      requireUserForApi.mockResolvedValueOnce({ user: sessionUser });

      const res = await POST(
        new NextRequest("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ postType: "lost" }) }),
      );

      expect(res.status).toBe(400);
      expect(getOrCreateDirectChatRoom).not.toHaveBeenCalled();
      expect(getOrCreateChatRoomForMatch).not.toHaveBeenCalled();
    });
  });
});
