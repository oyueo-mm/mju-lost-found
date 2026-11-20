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
// Phase 15-2 / Function Storage C-2: PUT's collaborator is now the queue-side
// requeue (no model, no inference); mocked wholesale -- no real $executeRaw
// in a route unit test.
const requeueImageJob = vi.fn();
// Function Storage C-2: edits and recompute requests ask /api/posts to drain.
const kickEmbeddingJobs = vi.fn();
const checkRateLimit = vi.fn();
const rateLimitTierFor = vi.fn();
// Phase J-2: the route itself must never clear the recommendation cache --
// the worker does that only after the new vector is saved.
const invalidateRecommendationCache = vi.fn();

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
vi.mock("@/lib/posts/updateService", () => ({
  updateLostPost,
  updateFoundPost,
}));
vi.mock("@/lib/ai/imageJobQueue", () => ({ requeueImageJob }));
vi.mock("@/lib/ai/imageJobKick", () => ({ kickEmbeddingJobs }));
vi.mock("@/lib/rateLimit", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/rateLimit")>()), checkRateLimit, rateLimitTierFor }));
const findPostRecommendations = vi.fn();
vi.mock("@/lib/recommendation/service", () => ({ invalidateRecommendationCache, findPostRecommendations }));
// Legal pre-beta Phase: only consulted for a temporarily hidden post.
const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
// after() needs a real request scope; capture callbacks and flush explicitly
// (same pattern as image/route.test.ts).
const { after, flushAfterCallbacks, resetAfterCallbacks } = vi.hoisted(() => {
  let afterCallbacks: Array<() => unknown> = [];
  const after = vi.fn((callback: () => unknown) => { afterCallbacks.push(callback); });
  async function flushAfterCallbacks() { const callbacks = afterCallbacks.splice(0); await Promise.all(callbacks.map((cb) => cb())); }
  function resetAfterCallbacks() { afterCallbacks = []; }
  return { after, flushAfterCallbacks, resetAfterCallbacks };
});
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after }));

const { GET, PATCH, PUT, DELETE } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  resetAfterCallbacks();
  requeueImageJob.mockResolvedValue("pending");
  kickEmbeddingJobs.mockResolvedValue("sent");
  checkRateLimit.mockResolvedValue({ ok: true });
  rateLimitTierFor.mockResolvedValue("user");
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
    expect(findPostRecommendations).not.toHaveBeenCalled();
  });

  // Phase 11-2: PendingRecommendations.tsx polls this same route with
  // ?include=recommendations instead of a new dedicated route.
  describe("?include=recommendations", () => {
    it("attaches recommendations to the post response", async () => {
      getLostPost.mockResolvedValueOnce({ id: 1, type: "lost", title: "t" });
      findPostRecommendations.mockResolvedValueOnce([{ id: 2, type: "found", title: "찾았어요" }]);

      const res = await GET(
        new NextRequest("http://localhost/api/posts/1?type=lost&include=recommendations"),
        params("1"),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(findPostRecommendations).toHaveBeenCalledWith("lost", 1);
      expect(json.data.recommendations).toEqual([{ id: 2, type: "found", title: "찾았어요" }]);
    });

    it("still returns the post (with an empty recommendations list) when recommendations fail to load", async () => {
      getLostPost.mockResolvedValueOnce({ id: 1, type: "lost", title: "t" });
      findPostRecommendations.mockRejectedValueOnce(new Error("db down"));

      const res = await GET(
        new NextRequest("http://localhost/api/posts/1?type=lost&include=recommendations"),
        params("1"),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.id).toBe(1);
      expect(json.data.recommendations).toEqual([]);
    });

    it("returns 404 (never reaching findPostRecommendations) for a nonexistent post", async () => {
      getLostPost.mockResolvedValueOnce(null);

      const res = await GET(
        new NextRequest("http://localhost/api/posts/999?type=lost&include=recommendations"),
        params("999"),
      );

      expect(res.status).toBe(404);
      expect(findPostRecommendations).not.toHaveBeenCalled();
    });
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
    expect(updateLostPost).toHaveBeenCalledWith(1, sessionUser, expect.any(Object));
  });

  // Function Storage C-2: the DB trigger queues the text job; the route only
  // asks /api/posts to drain it, after the response.
  it("asks /api/posts to drain after a successful text edit (no inference here)", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    updateFoundPost.mockResolvedValueOnce({ kind: "ok", data: { id: 1, title: "new" } });

    const res = await PATCH(new NextRequest("http://localhost/api/posts/1?type=found", { method: "PATCH", body: JSON.stringify({ description: "새 설명" }) }), params("1"));

    expect(res.status).toBe(200);
    expect(kickEmbeddingJobs).not.toHaveBeenCalled();
    await flushAfterCallbacks();
    expect(kickEmbeddingJobs).toHaveBeenCalledWith("http://localhost");
    expect(invalidateRecommendationCache).not.toHaveBeenCalled();
  });

  it("sends no drain request for a status-only edit", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    updateLostPost.mockResolvedValueOnce({ kind: "ok", data: { id: 1 } });

    await PATCH(new NextRequest("http://localhost/api/posts/1?type=lost", { method: "PATCH", body: JSON.stringify({ status: "찾음" }) }), params("1"));
    await flushAfterCallbacks();

    expect(kickEmbeddingJobs).not.toHaveBeenCalled();
  });

  it("sends no drain request when the edit is refused", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    updateLostPost.mockResolvedValueOnce({ kind: "forbidden", reason: "not_owner" });

    await PATCH(new NextRequest("http://localhost/api/posts/1?type=lost", { method: "PATCH", body: JSON.stringify({ title: "x" }) }), params("1"));
    await flushAfterCallbacks();

    expect(kickEmbeddingJobs).not.toHaveBeenCalled();
  });

  it("logs, never throws, when the drain request fails (the job stays queued)", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    updateLostPost.mockResolvedValueOnce({ kind: "ok", data: { id: 1 } });
    kickEmbeddingJobs.mockResolvedValueOnce("failed");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await PATCH(new NextRequest("http://localhost/api/posts/1?type=lost", { method: "PATCH", body: JSON.stringify({ title: "new" }) }), params("1"));
    await flushAfterCallbacks();

    expect(res.status).toBe(200);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Embedding drain request failed"));
    error.mockRestore();
  });
});

// Phase 15-2, internal-only: triggered by POST /api/posts/[id]/image
// after a successful image attach (see that route's own comment for why
// this indirection exists). Same auth/ownership gate as PATCH/DELETE.
describe("PUT /api/posts/[id] (owner/tool: recompute image embedding)", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await PUT(new NextRequest("http://localhost/api/posts/1?type=lost", { method: "PUT" }), params("1"));

    expect(res.status).toBe(401);
    expect(requeueImageJob).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent post", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getLostPost.mockResolvedValueOnce(null);

    const res = await PUT(new NextRequest("http://localhost/api/posts/1?type=lost", { method: "PUT" }), params("1"));

    expect(res.status).toBe(404);
    expect(requeueImageJob).not.toHaveBeenCalled();
  });

  it("rejects triggering embedding for someone else's post", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getLostPost.mockResolvedValueOnce({ id: 1, imageUrl: "https://x/y.jpg", author: { id: 999 } });

    const res = await PUT(new NextRequest("http://localhost/api/posts/1?type=lost", { method: "PUT" }), params("1"));

    expect(res.status).toBe(403);
    expect(requeueImageJob).not.toHaveBeenCalled();
  });

  it("re-arms the durable job for the owner and asks /api/posts to drain (no inference here)", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getLostPost.mockResolvedValueOnce({ id: 1, imageUrl: "https://x/y.jpg", author: { id: sessionUser.id } });

    const res = await PUT(new NextRequest("http://localhost/api/posts/1?type=lost", { method: "PUT" }), params("1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.embedded).toBe(false);
    expect(json.data.jobStatus).toBe("pending");
    expect(requeueImageJob).toHaveBeenCalledWith("lost", 1);
    expect(checkRateLimit).toHaveBeenCalledWith("embeddingRecompute", { userId: sessionUser.id, tier: "user" });
    expect(kickEmbeddingJobs).not.toHaveBeenCalled(); // deferred to after()
    await flushAfterCallbacks();
    expect(kickEmbeddingJobs).toHaveBeenCalledWith("http://localhost");
    expect(invalidateRecommendationCache).not.toHaveBeenCalled();
  });

  it("reports an already current embedding without a drain request", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getLostPost.mockResolvedValueOnce({ id: 1, imageUrl: "https://x/y.jpg", author: { id: sessionUser.id } });
    requeueImageJob.mockResolvedValueOnce("reused");

    const res = await PUT(new NextRequest("http://localhost/api/posts/1?type=lost", { method: "PUT" }), params("1"));
    const json = await res.json();

    expect(json.data).toEqual({ embedded: true, jobStatus: "reused" });
    await flushAfterCallbacks();
    expect(kickEmbeddingJobs).not.toHaveBeenCalled();
  });

  it("refuses beyond the owner's manual recompute budget without touching the job", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getLostPost.mockResolvedValueOnce({ id: 1, imageUrl: "https://x/y.jpg", author: { id: sessionUser.id } });
    checkRateLimit.mockResolvedValueOnce({ ok: false, reason: "limited", retryAfterSeconds: 30 });

    const res = await PUT(new NextRequest("http://localhost/api/posts/1?type=lost", { method: "PUT" }), params("1"));

    expect(res.status).toBe(429);
    expect(requeueImageJob).not.toHaveBeenCalled();
    await flushAfterCallbacks();
    expect(kickEmbeddingJobs).not.toHaveBeenCalled();
  });

  it("does nothing (but still succeeds) when the post has no image", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getLostPost.mockResolvedValueOnce({ id: 1, imageUrl: null, author: { id: sessionUser.id } });

    const res = await PUT(new NextRequest("http://localhost/api/posts/1?type=lost", { method: "PUT" }), params("1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.embedded).toBe(false);
    expect(requeueImageJob).not.toHaveBeenCalled();
    expect(invalidateRecommendationCache).not.toHaveBeenCalled();
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

describe("release C (M-1): PUT /api/posts/[id] for a suspended author", () => {
  it("does not recompute the image embedding", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: { ...sessionUser, isSuspended: true, suspendedUntil: null } });
    getLostPost.mockResolvedValueOnce({ id: 1, imageUrl: "https://x/y.jpg", author: { id: sessionUser.id } });

    const res = await PUT(new NextRequest("http://localhost/api/posts/1?type=lost", { method: "PUT" }), params("1"));

    expect(res.status).toBe(403);
    expect(getLostPost).not.toHaveBeenCalled();
    expect(requeueImageJob).not.toHaveBeenCalled();
    expect(invalidateRecommendationCache).not.toHaveBeenCalled();
  });
});
