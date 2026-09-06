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
// Phase 15-2: PUT's own collaborator, mocked wholesale -- never loading
// the real ~99MB SigLIP model or issuing a real $executeRaw here, same
// convention as this project's other embedding-adjacent route tests.
const embedPostImageBestEffort = vi.fn();

// See route.test.ts for why this is a full mock rather than importActual.
vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireUserForApi };
});
vi.mock("@/lib/posts/service", () => ({
  getLostPost,
  getFoundPost,
  deleteLostPost,
  deleteFoundPost,
}));
vi.mock("@/lib/posts/aiService", () => ({
  updateLostPost,
  updateFoundPost,
}));
vi.mock("@/lib/ai/postEmbedding", () => ({ embedPostImageBestEffort }));

const { GET, PATCH, PUT, DELETE } = await import("./route");

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

  // Phase 9: StatusChangeControl PATCHes a status-only body through this
  // same route -- these two confirm the existing auth/ownership gate
  // (which runs before the body is even inspected) covers that body shape
  // too, not just a title/description update.
  it("rejects an unauthenticated status-change request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await PATCH(
      new NextRequest("http://localhost/api/posts/1?type=lost", {
        method: "PATCH",
        body: JSON.stringify({ status: "찾음" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(401);
    expect(updateLostPost).not.toHaveBeenCalled();
  });

  it("rejects a non-owner's status-change request", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    updateLostPost.mockResolvedValueOnce({ kind: "forbidden", reason: "not_owner" });

    const res = await PATCH(
      new NextRequest("http://localhost/api/posts/1?type=lost", {
        method: "PATCH",
        body: JSON.stringify({ status: "찾음" }),
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

// Phase 15-2, internal-only: triggered by POST /api/posts/[id]/image
// after a successful image attach (see that route's own comment for why
// this indirection exists). Same auth/ownership gate as PATCH/DELETE.
describe("PUT /api/posts/[id] (internal: recompute image embedding)", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await PUT(new NextRequest("http://localhost/api/posts/1?type=lost", { method: "PUT" }), params("1"));

    expect(res.status).toBe(401);
    expect(embedPostImageBestEffort).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent post", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getLostPost.mockResolvedValueOnce(null);

    const res = await PUT(new NextRequest("http://localhost/api/posts/1?type=lost", { method: "PUT" }), params("1"));

    expect(res.status).toBe(404);
    expect(embedPostImageBestEffort).not.toHaveBeenCalled();
  });

  it("rejects triggering embedding for someone else's post", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getLostPost.mockResolvedValueOnce({ id: 1, imageUrl: "https://x/y.jpg", author: { id: 999 } });

    const res = await PUT(new NextRequest("http://localhost/api/posts/1?type=lost", { method: "PUT" }), params("1"));

    expect(res.status).toBe(403);
    expect(embedPostImageBestEffort).not.toHaveBeenCalled();
  });

  it("computes the embedding from the post's current imageUrl for the owner", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getLostPost.mockResolvedValueOnce({ id: 1, imageUrl: "https://x/y.jpg", author: { id: sessionUser.id } });

    const res = await PUT(new NextRequest("http://localhost/api/posts/1?type=lost", { method: "PUT" }), params("1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.embedded).toBe(true);
    expect(embedPostImageBestEffort).toHaveBeenCalledWith("lost", 1, "https://x/y.jpg");
  });

  it("does nothing (but still succeeds) when the post has no image", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getLostPost.mockResolvedValueOnce({ id: 1, imageUrl: null, author: { id: sessionUser.id } });

    const res = await PUT(new NextRequest("http://localhost/api/posts/1?type=lost", { method: "PUT" }), params("1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.embedded).toBe(false);
    expect(embedPostImageBestEffort).not.toHaveBeenCalled();
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
