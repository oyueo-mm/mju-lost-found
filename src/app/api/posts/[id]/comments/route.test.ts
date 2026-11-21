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
const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
// A-1: real canViewPost rule, only the DB read is mocked.
const getPostVisibility = vi.fn();
vi.mock("@/lib/posts/visibility", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/posts/visibility")>()), getPostVisibility }));
const PUBLIC_POST = { authorId: 7, tempHiddenAt: null, removedAt: null };

const { GET, POST } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };
const params = () => ({ params: Promise.resolve({ id: "1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  getPostVisibility.mockResolvedValue(PUBLIC_POST);
  getCurrentUser.mockResolvedValue(null);
});

// Security audit 2026-11-21 (A-1): comments are as visible as their post.
describe("comments of a non-public post (A-1)", () => {
  const get = () => GET(new NextRequest("http://localhost/api/posts/1/comments?type=lost"), params());
  const hidden = { authorId: 7, tempHiddenAt: new Date(), removedAt: null };
  const removed = { authorId: 7, tempHiddenAt: null, removedAt: new Date() };
  const admin = { id: 2, isAdmin: false, adminPermissions: ["reports.view"] };

  it("404 for a missing post", async () => {
    getPostVisibility.mockResolvedValueOnce(null);
    expect((await get()).status).toBe(404);
    expect(listCommentsForPost).not.toHaveBeenCalled();
  });
  it("temp-hidden: 404 for anonymous and other members, comments never read", async () => {
    getPostVisibility.mockResolvedValue(hidden);
    expect((await get()).status).toBe(404);
    getCurrentUser.mockResolvedValueOnce({ id: 3, isAdmin: false, adminPermissions: [] });
    expect((await get()).status).toBe(404);
    expect(listCommentsForPost).not.toHaveBeenCalled();
  });
  it("temp-hidden: the author and report admins still see them", async () => {
    getPostVisibility.mockResolvedValue(hidden);
    listCommentsForPost.mockResolvedValue([]);
    getCurrentUser.mockResolvedValueOnce({ id: 7, isAdmin: false, adminPermissions: [] });
    expect((await get()).status).toBe(200);
    getCurrentUser.mockResolvedValueOnce(admin);
    expect((await get()).status).toBe(200);
  });
  it("removed: admins only -- not even the (withdrawn) author", async () => {
    getPostVisibility.mockResolvedValue(removed);
    listCommentsForPost.mockResolvedValue([]);
    getCurrentUser.mockResolvedValueOnce({ id: 7, isAdmin: false, adminPermissions: [] });
    expect((await get()).status).toBe(404);
    getCurrentUser.mockResolvedValueOnce(admin);
    expect((await get()).status).toBe(200);
  });
  it("no new comment on a post the member may not see", async () => {
    getPostVisibility.mockResolvedValueOnce(hidden);
    requireUserForApi.mockResolvedValueOnce({ user: { id: 3, isAdmin: false, adminPermissions: [] } });
    const res = await POST(new NextRequest("http://localhost/api/posts/1/comments?type=lost", { method: "POST", body: JSON.stringify({ content: "안녕하세요" }) }), params());
    expect(res.status).toBe(404);
    expect(createComment).not.toHaveBeenCalled();
  });
  it("a suspended viewer counts as no admin", async () => {
    getPostVisibility.mockResolvedValueOnce(removed);
    getCurrentUser.mockResolvedValueOnce({ id: 2, isAdmin: true, adminPermissions: [], isSuspended: true, suspendedUntil: new Date(Date.now() + 86400000) });
    expect((await get()).status).toBe(404);
  });
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

  it("passes parentId through to createComment as a reply", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    createComment.mockResolvedValueOnce({
      kind: "ok",
      data: { id: 2, content: "네!", createdAt: new Date(), updatedAt: new Date(), parentId: 1, author: sessionUser },
    });

    const res = await POST(
      new NextRequest("http://localhost/api/posts/1/comments?type=lost", {
        method: "POST",
        body: JSON.stringify({ content: "네!", parentId: 1 }),
      }),
      params(),
    );

    expect(res.status).toBe(201);
    expect(createComment).toHaveBeenCalledWith(sessionUser, "lost", 1, { content: "네!", parentId: 1 });
  });

  it("returns 404 when replying to a nonexistent/other-post parentId", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    createComment.mockResolvedValueOnce({ kind: "parent_not_found" });

    const res = await POST(
      new NextRequest("http://localhost/api/posts/1/comments?type=lost", {
        method: "POST",
        body: JSON.stringify({ content: "네!", parentId: 999 }),
      }),
      params(),
    );

    expect(res.status).toBe(404);
  });

  // Phase H-3: replying to a reply is now allowed -- parentId can name any
  // existing comment on this post regardless of its own depth, so a reply
  // whose parentId itself belongs to a reply flows through exactly like
  // any other parentId (see the "passes parentId through" test above).
  it("passes parentId through even when it names a reply, not just a top-level comment", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    createComment.mockResolvedValueOnce({
      kind: "ok",
      data: { id: 3, content: "답글의 답글", createdAt: new Date(), updatedAt: new Date(), parentId: 2, author: sessionUser },
    });

    const res = await POST(
      new NextRequest("http://localhost/api/posts/1/comments?type=lost", {
        method: "POST",
        body: JSON.stringify({ content: "답글의 답글", parentId: 2 }),
      }),
      params(),
    );

    expect(res.status).toBe(201);
    expect(createComment).toHaveBeenCalledWith(sessionUser, "lost", 1, { content: "답글의 답글", parentId: 2 });
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
