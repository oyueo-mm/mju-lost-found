import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const createMatch = vi.fn();
const listMatchesForPost = vi.fn();
const listMatchesForUser = vi.fn();

// Mocked wholesale (not via importActual) so this never loads the real
// @/lib/posts/http.ts, which imports next-auth through getCurrentUser() --
// next-auth doesn't resolve under Vitest's plain Node ESM outside of
// Next's own bundler.
vi.mock("@/lib/match/http", async () => {
  const response = await import("@/lib/posts/response");
  const matchResponse = await import("@/lib/match/response");
  return { ...response, ...matchResponse, requireUserForApi };
});
vi.mock("@/lib/match/service", () => ({ createMatch, listMatchesForPost, listMatchesForUser }));

const { GET, POST } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/matches", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await GET(new NextRequest("http://localhost/api/matches"));

    expect(res.status).toBe(401);
    expect(listMatchesForUser).not.toHaveBeenCalled();
  });

  it("returns the current user's matches when no postId/type is given", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    listMatchesForUser.mockResolvedValueOnce([{ id: 1 }]);

    const res = await GET(new NextRequest("http://localhost/api/matches"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([{ id: 1 }]);
    expect(listMatchesForUser).toHaveBeenCalledWith(1);
  });

  it("rejects postId without type", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });

    const res = await GET(new NextRequest("http://localhost/api/matches?postId=1"));

    expect(res.status).toBe(400);
  });

  it("returns matches for a specific post the user owns", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    listMatchesForPost.mockResolvedValueOnce({ kind: "ok", data: [] });

    const res = await GET(new NextRequest("http://localhost/api/matches?postId=5&type=lost"));

    expect(res.status).toBe(200);
    expect(listMatchesForPost).toHaveBeenCalledWith("lost", 5, 1);
  });

  it("rejects listing matches for a post the user doesn't own", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    listMatchesForPost.mockResolvedValueOnce({ kind: "forbidden", reason: "not_owner" });

    const res = await GET(new NextRequest("http://localhost/api/matches?postId=5&type=lost"));

    expect(res.status).toBe(403);
  });
});

describe("POST /api/matches", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await POST(
      new NextRequest("http://localhost/api/matches", {
        method: "POST",
        body: JSON.stringify({ lostPostId: 1, foundPostId: 2 }),
      }),
    );

    expect(res.status).toBe(401);
    expect(createMatch).not.toHaveBeenCalled();
  });

  it("rejects an invalid body", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });

    const res = await POST(
      new NextRequest("http://localhost/api/matches", {
        method: "POST",
        body: JSON.stringify({ lostPostId: 1 }),
      }),
    );

    expect(res.status).toBe(400);
    expect(createMatch).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent LostPost", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    createMatch.mockResolvedValueOnce({ kind: "lost_not_found" });

    const res = await POST(
      new NextRequest("http://localhost/api/matches", {
        method: "POST",
        body: JSON.stringify({ lostPostId: 999, foundPostId: 2 }),
      }),
    );

    expect(res.status).toBe(404);
  });

  it("creates a match as the current session user", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    createMatch.mockResolvedValueOnce({ kind: "ok", data: { id: 1 } });

    const res = await POST(
      new NextRequest("http://localhost/api/matches", {
        method: "POST",
        body: JSON.stringify({ lostPostId: 1, foundPostId: 2 }),
      }),
    );

    expect(res.status).toBe(201);
    expect(createMatch).toHaveBeenCalledWith(sessionUser, { lostPostId: 1, foundPostId: 2 });
  });
});
