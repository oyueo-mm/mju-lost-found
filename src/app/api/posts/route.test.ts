import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const searchPosts = vi.fn();
const createLostPost = vi.fn();
const createFoundPost = vi.fn();

// Mocked wholesale (not via importActual) so this never loads the real
// @/lib/posts/http.ts, which imports next-auth through getCurrentUser() --
// next-auth's package doesn't resolve under Vitest's plain Node ESM
// outside of Next's own bundler. The response helpers re-exported here
// are the real ones (from the auth-free @/lib/posts/response.ts), only
// requireUserForApi is faked.
vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireUserForApi };
});
vi.mock("@/lib/posts/service", () => ({
  searchPosts,
  createLostPost,
  createFoundPost,
}));

const { GET, POST } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/posts", () => {
  it("rejects an unrecognized type", async () => {
    const res = await GET(new NextRequest("http://localhost/api/posts?type=banana"));
    expect(res.status).toBe(400);
  });

  it("accepts type=all", async () => {
    searchPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    const res = await GET(new NextRequest("http://localhost/api/posts?type=all"));
    expect(res.status).toBe(200);
  });

  it("clamps an excessive limit before querying the DB", async () => {
    searchPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 50, total: 0, totalPages: 1 });

    await GET(new NextRequest("http://localhost/api/posts?type=lost&limit=100000"));

    expect(searchPosts).toHaveBeenCalledWith(expect.objectContaining({ type: "lost", page: 1, limit: 50 }));
  });

  it("rejects a search query longer than the max length", async () => {
    const res = await GET(
      new NextRequest(`http://localhost/api/posts?type=lost&q=${"a".repeat(101)}`),
    );
    expect(res.status).toBe(400);
    expect(searchPosts).not.toHaveBeenCalled();
  });

  it("rejects an invalid sort value", async () => {
    const res = await GET(new NextRequest("http://localhost/api/posts?type=lost&sort=random"));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid date", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/posts?type=lost&dateFrom=not-a-date"),
    );
    expect(res.status).toBe(400);
  });

  it("passes q/category/location/sort through to the service layer", async () => {
    searchPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });

    await GET(
      new NextRequest(
        "http://localhost/api/posts?type=lost&q=지갑&category=전자기기&location=학생회관&sort=oldest",
      ),
    );

    expect(searchPosts).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "lost",
        q: "지갑",
        category: "전자기기",
        location: "학생회관",
        sort: "oldest",
      }),
    );
  });

  it("requires no authentication -- search/list is public", async () => {
    searchPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });

    const res = await GET(new NextRequest("http://localhost/api/posts?type=all&q=지갑"));

    expect(res.status).toBe(200);
    expect(requireUserForApi).not.toHaveBeenCalled();
  });

  it("includes totalPages in the pagination envelope", async () => {
    searchPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 41, totalPages: 3 });

    const res = await GET(new NextRequest("http://localhost/api/posts?type=lost"));
    const json = await res.json();

    expect(json.pagination).toEqual({ page: 1, limit: 20, total: 41, totalPages: 3 });
  });
});

describe("POST /api/posts", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await POST(
      new NextRequest("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({ type: "lost" }),
      }),
    );

    expect(res.status).toBe(401);
    expect(createLostPost).not.toHaveBeenCalled();
  });

  it("rejects a request missing required fields", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });

    const res = await POST(
      new NextRequest("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({ type: "lost", title: "제목만 있음" }),
      }),
    );

    expect(res.status).toBe(400);
    expect(createLostPost).not.toHaveBeenCalled();
  });

  it("creates a LostPost as the current session user, not any userId in the body", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    createLostPost.mockResolvedValueOnce({
      kind: "ok",
      data: { id: 10, type: "lost", author: { id: 1, nickname: "닉네임" } },
    });

    const res = await POST(
      new NextRequest("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({
          type: "lost",
          title: "지갑을 잃어버렸어요",
          description: "검은색 지갑",
          category: "지갑",
          location: "학생회관",
          lostAt: "2026-01-01T10:00",
          userId: 999, // must be ignored -- author comes from the session
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.author.id).toBe(1);
    expect(createLostPost).toHaveBeenCalledWith(sessionUser, expect.any(Object));
  });

  it("creates a FoundPost when type is 'found'", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    createFoundPost.mockResolvedValueOnce({
      kind: "ok",
      data: { id: 11, type: "found" },
    });

    const res = await POST(
      new NextRequest("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({
          type: "found",
          title: "지갑을 주웠어요",
          description: "검은색 지갑",
          category: "지갑",
          location: "학생회관",
          foundAt: "2026-01-01T10:00",
        }),
      }),
    );

    expect(res.status).toBe(201);
    expect(createFoundPost).toHaveBeenCalled();
  });
});
