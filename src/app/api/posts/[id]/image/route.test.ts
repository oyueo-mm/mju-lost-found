import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const setPostImage = vi.fn();
const clearPostImage = vi.fn();
// Phase 15-2: this route triggers image-embedding computation via a real
// internal HTTP request (see its own comment for why -- Vercel
// function-bundle-size reasons) rather than importing anything
// embedding-related directly, so the only new thing to mock/assert here
// is the global fetch call itself, never a model/AI collaborator.
const fetchMock = vi.fn();

vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireUserForApi };
});
vi.mock("@/lib/images/service", () => ({ setPostImage, clearPostImage }));

const { POST, DELETE } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
});

describe("POST /api/posts/[id]/image", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await POST(
      new NextRequest("http://localhost/api/posts/1/image?type=lost", {
        method: "POST",
        body: JSON.stringify({ path: "posts/lost/1/y.jpg" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(401);
    expect(setPostImage).not.toHaveBeenCalled();
  });

  it("rejects a path that never went through our upload flow", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    setPostImage.mockResolvedValueOnce({ kind: "invalid_path" });

    const res = await POST(
      new NextRequest("http://localhost/api/posts/1/image?type=lost", {
        method: "POST",
        body: JSON.stringify({ path: "whatever" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects changing someone else's post image", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    setPostImage.mockResolvedValueOnce({ kind: "forbidden" });

    const res = await POST(
      new NextRequest("http://localhost/api/posts/1/image?type=lost", {
        method: "POST",
        body: JSON.stringify({ path: "posts/lost/1/y.jpg" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("attaches the image for the owner", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    setPostImage.mockResolvedValueOnce({ kind: "ok", data: { imageUrl: "https://x/y.jpg" } });

    const res = await POST(
      new NextRequest("http://localhost/api/posts/1/image?type=lost", {
        method: "POST",
        body: JSON.stringify({ path: "posts/lost/1/y.jpg" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(200);
    expect(setPostImage).toHaveBeenCalledWith("lost", 1, sessionUser.id, {
      path: "posts/lost/1/y.jpg",
    });
  });

  // Phase G-4: the optional cleanup hint just passes through the schema to
  // setPostImage unchanged -- all the actual re-validation of it happens
  // server-side inside setPostImage itself (see that module's own tests),
  // this only confirms the route wires the field through at all.
  it("forwards previousAttemptPath to setPostImage when the client includes it", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    setPostImage.mockResolvedValueOnce({ kind: "ok", data: { imageUrl: "https://x/y.jpg" } });

    await POST(
      new NextRequest("http://localhost/api/posts/1/image?type=lost", {
        method: "POST",
        body: JSON.stringify({ path: "posts/lost/1/y.jpg", previousAttemptPath: "posts/lost/1/old.jpg" }),
      }),
      params("1"),
    );

    expect(setPostImage).toHaveBeenCalledWith("lost", 1, sessionUser.id, {
      path: "posts/lost/1/y.jpg",
      previousAttemptPath: "posts/lost/1/old.jpg",
    });
  });

  // Phase 15-2: only a successful attach triggers the internal
  // image-embedding request -- never for a rejected one (already covered
  // by the `not.toHaveBeenCalled()` assertions above).
  it("triggers the internal image-embedding request (PUT /api/posts/[id]) after a successful attach", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    setPostImage.mockResolvedValueOnce({ kind: "ok", data: { imageUrl: "https://x/y.jpg" } });

    await POST(
      new NextRequest("http://localhost/api/posts/1/image?type=lost", {
        method: "POST",
        headers: { cookie: "authjs.session-token=abc123" },
        body: JSON.stringify({ path: "posts/lost/1/y.jpg" }),
      }),
      params("1"),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost/api/posts/1?type=lost",
      expect.objectContaining({ method: "PUT", headers: { cookie: "authjs.session-token=abc123" } }),
    );
  });

  it("still returns the successful attach response even if the embedding trigger request fails", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    setPostImage.mockResolvedValueOnce({ kind: "ok", data: { imageUrl: "https://x/y.jpg" } });
    fetchMock.mockRejectedValueOnce(new Error("network error"));

    const res = await POST(
      new NextRequest("http://localhost/api/posts/1/image?type=lost", {
        method: "POST",
        body: JSON.stringify({ path: "posts/lost/1/y.jpg" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/posts/[id]/image", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await DELETE(
      new NextRequest("http://localhost/api/posts/1/image?type=lost", { method: "DELETE" }),
      params("1"),
    );

    expect(res.status).toBe(401);
    expect(clearPostImage).not.toHaveBeenCalled();
  });

  it("rejects deleting someone else's post image", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    clearPostImage.mockResolvedValueOnce({ kind: "forbidden" });

    const res = await DELETE(
      new NextRequest("http://localhost/api/posts/1/image?type=lost", { method: "DELETE" }),
      params("1"),
    );

    expect(res.status).toBe(403);
  });

  it("clears the image for the owner, resulting in a null imageUrl", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    clearPostImage.mockResolvedValueOnce({ kind: "ok", data: { imageUrl: null } });

    const res = await DELETE(
      new NextRequest("http://localhost/api/posts/1/image?type=lost", { method: "DELETE" }),
      params("1"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.imageUrl).toBeNull();
  });
});
