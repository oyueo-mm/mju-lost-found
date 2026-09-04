import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const getChatRoomForUser = vi.fn();

vi.mock("@/lib/chat/http", async () => {
  const response = await import("@/lib/posts/response");
  const chatResponse = await import("@/lib/chat/response");
  return { ...response, ...chatResponse, requireUserForApi };
});
vi.mock("@/lib/chat/service", () => ({ getChatRoomForUser }));

const { GET } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/chat/[id]", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await GET(new NextRequest("http://localhost/api/chat/1"), params("1"));

    expect(res.status).toBe(401);
    expect(getChatRoomForUser).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent room", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getChatRoomForUser.mockResolvedValueOnce({ kind: "not_found" });

    const res = await GET(new NextRequest("http://localhost/api/chat/999"), params("999"));

    expect(res.status).toBe(404);
  });

  it("rejects a user who isn't a participant (A's room ID known by B)", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getChatRoomForUser.mockResolvedValueOnce({ kind: "forbidden" });

    const res = await GET(new NextRequest("http://localhost/api/chat/1"), params("1"));

    expect(res.status).toBe(403);
  });

  it("returns the room for an authorized participant", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getChatRoomForUser.mockResolvedValueOnce({ kind: "ok", data: { id: 1 } });

    const res = await GET(new NextRequest("http://localhost/api/chat/1"), params("1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe(1);
    expect(getChatRoomForUser).toHaveBeenCalledWith(1, sessionUser.id);
  });
});
