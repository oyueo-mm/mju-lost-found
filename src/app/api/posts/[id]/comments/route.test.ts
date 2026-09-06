import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const listCommentsForPost = vi.fn();
const createComment = vi.fn();

// See sibling route tests (e.g. src/app/api/posts/route.test.ts) for why
// this is a full mock rather than importActual -- @/lib/posts/http pulls
// in next-auth via getCurrentUser(), which doesn't resolve under Vitest's
// plain Node ESM outside of Next's own bundler.
vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireUserForApi };
});
vi.mock("@/lib/comment/service", () => ({ listCommentsForPost, createComment }));

const { GET, POST } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };
const params = () => ({ params: Promise.resolve({ id: "1" }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/posts/[id]/comments", () => {
  it("rejects a missing/invalid type", async () => {
    const res = await GET(new NextRequest("http://localhost/api/posts/1/comments"), params());
    expect(res.status).toBe(400);
  });

  it("is public -- never gated by requireUserForApi", async () => {
    listCommentsForPost.mockResolvedValueOnce([]);
    const res = await GET(new NextRequest("http://localhost/api/posts/1/comments?type=lost"), params());
    expect(res.status).toBe(200);
    expect(requireUserForApi).not.toHaveBeenCalled();
  });
});

describe("POST /api/posts/[id]/comments", () => {
  it("requires login", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });
    const res = await POST(
      new NextRequest("http://localhost/api/posts/1/comments?type=lost", {
        method: "POST",
        body: JSON.stringify({ content: "안녕하세요" }),
      }),
      params(),
    );
    expect(res.status).toBe(401);
    expect(createComment).not.toHaveBeenCalled();
  });

  it("rejects empty content", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    const res = await POST(
      new NextRequest("http://localhost/api/posts/1/comments?type=lost", {
        method: "POST",
        body: JSON.stringify({ content: "" }),
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(createComment).not.toHaveBeenCalled();
  });

  it("creates a comment for a logged-in user", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    createComment.mockResolvedValueOnce({
      kind: "ok",
      data: { id: 1, content: "안녕하세요", createdAt: new Date(), updatedAt: new Date(), author: sessionUser },
    });

    const res = await POST(
      new NextRequest("http://localhost/api/posts/1/comments?type=lost", {
        method: "POST",
        body: JSON.stringify({ content: "안녕하세요" }),
      }),
      params(),
    );

    expect(res.status).toBe(201);
    expect(createComment).toHaveBeenCalledWith(sessionUser, "lost", 1, { content: "안녕하세요" });
  });

  it("blocks a suspended user with 403", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    createComment.mockResolvedValueOnce({ kind: "forbidden", reason: "suspended" });

    const res = await POST(
      new NextRequest("http://localhost/api/posts/1/comments?type=lost", {
        method: "POST",
        body: JSON.stringify({ content: "안녕하세요" }),
      }),
      params(),
    );

    expect(res.status).toBe(403);
  });
});
