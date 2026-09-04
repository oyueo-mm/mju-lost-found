import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const getLostPost = vi.fn();
const getFoundPost = vi.fn();
const updateLostPost = vi.fn();
const updateFoundPost = vi.fn();
const deleteLostPost = vi.fn();
const deleteFoundPost = vi.fn();

// See route.test.ts for why this is a full mock rather than importActual.
vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireUserForApi };
});
vi.mock("@/lib/posts/service", () => ({
  getLostPost,
  getFoundPost,
  updateLostPost,
  updateFoundPost,
  deleteLostPost,
  deleteFoundPost,
}));

const { GET, PATCH, DELETE } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/posts/[id]", () => {
  it("rejects a missing/invalid type", async () => {
    const res = await GET(new NextRequest("http://localhost/api/posts/1"), params("1"));
    expect(res.status).toBe(400);
  });

  it("returns 404 for a nonexistent post", async () => {
    getLostPost.mockResolvedValueOnce(null);

    const res = await GET(
      new NextRequest("http://localhost/api/posts/999?type=lost"),
      params("999"),
    );

    expect(res.status).toBe(404);
  });

  it("returns the post when found", async () => {
    getLostPost.mockResolvedValueOnce({ id: 1, type: "lost", title: "t" });

    const res = await GET(new NextRequest("http://localhost/api/posts/1?type=lost"), params("1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe(1);
  });
});

describe("PATCH /api/posts/[id]", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await PATCH(
      new NextRequest("http://localhost/api/posts/1?type=lost", {
        method: "PATCH",
        body: JSON.stringify({ title: "수정" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(401);
    expect(updateLostPost).not.toHaveBeenCalled();
  });

  it("rejects updating someone else's post", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    updateLostPost.mockResolvedValueOnce({ kind: "forbidden", reason: "not_owner" });

    const res = await PATCH(
      new NextRequest("http://localhost/api/posts/1?type=lost", {
        method: "PATCH",
        body: JSON.stringify({ title: "해킹 시도" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(403);
  });

  it("allows the owner to update their own post", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    updateLostPost.mockResolvedValueOnce({ kind: "ok", data: { id: 1, title: "새 제목" } });

    const res = await PATCH(
      new NextRequest("http://localhost/api/posts/1?type=lost", {
        method: "PATCH",
        body: JSON.stringify({ title: "새 제목" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(200);
    expect(updateLostPost).toHaveBeenCalledWith(1, sessionUser.id, expect.any(Object));
  });
});

describe("DELETE /api/posts/[id]", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await DELETE(
      new NextRequest("http://localhost/api/posts/1?type=lost", { method: "DELETE" }),
      params("1"),
    );

    expect(res.status).toBe(401);
    expect(deleteLostPost).not.toHaveBeenCalled();
  });

  it("rejects deleting someone else's post", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    deleteFoundPost.mockResolvedValueOnce({ kind: "forbidden", reason: "not_owner" });

    const res = await DELETE(
      new NextRequest("http://localhost/api/posts/1?type=found", { method: "DELETE" }),
      params("1"),
    );

    expect(res.status).toBe(403);
  });

  it("allows the owner to delete their own post", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    deleteLostPost.mockResolvedValueOnce({ kind: "ok", data: { id: 1 } });

    const res = await DELETE(
      new NextRequest("http://localhost/api/posts/1?type=lost", { method: "DELETE" }),
      params("1"),
    );

    expect(res.status).toBe(200);
  });
});
