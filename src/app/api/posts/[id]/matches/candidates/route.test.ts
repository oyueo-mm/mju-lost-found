import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const findMatchCandidates = vi.fn();

// Mocked wholesale (not via importActual) so this never loads the real
// @/lib/posts/http.ts, which imports next-auth through getCurrentUser() --
// next-auth doesn't resolve under Vitest's plain Node ESM outside of
// Next's own bundler.
vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireUserForApi };
});
vi.mock("@/lib/match/candidates", () => ({ findMatchCandidates }));

const { GET } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/posts/[id]/matches/candidates", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await GET(
      new NextRequest("http://localhost/api/posts/1/matches/candidates?type=lost"),
      params("1"),
    );

    expect(res.status).toBe(401);
    expect(findMatchCandidates).not.toHaveBeenCalled();
  });

  it("rejects a missing/invalid type", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });

    const res = await GET(new NextRequest("http://localhost/api/posts/1/matches/candidates"), params("1"));

    expect(res.status).toBe(400);
  });

  it("returns 404 for a nonexistent post", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    findMatchCandidates.mockResolvedValueOnce({ kind: "not_found" });

    const res = await GET(
      new NextRequest("http://localhost/api/posts/999/matches/candidates?type=lost"),
      params("999"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 403 for a post the user doesn't own", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    findMatchCandidates.mockResolvedValueOnce({ kind: "forbidden" });

    const res = await GET(
      new NextRequest("http://localhost/api/posts/1/matches/candidates?type=lost"),
      params("1"),
    );

    expect(res.status).toBe(403);
  });

  it("returns 503 when the AI ranker is unavailable, without a raw 500", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    findMatchCandidates.mockResolvedValueOnce({ kind: "ai_unavailable" });

    const res = await GET(
      new NextRequest("http://localhost/api/posts/1/matches/candidates?type=lost"),
      params("1"),
    );

    expect(res.status).toBe(503);
  });

  it("returns candidates for the owner", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    findMatchCandidates.mockResolvedValueOnce({
      kind: "ok",
      data: [{ postId: 5, type: "found", score: 0.9, title: "t", category: "c", location: "l", imageUrl: null }],
    });

    const res = await GET(
      new NextRequest("http://localhost/api/posts/1/matches/candidates?type=lost"),
      params("1"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(findMatchCandidates).toHaveBeenCalledWith("lost", 1, sessionUser.id);
  });
});
