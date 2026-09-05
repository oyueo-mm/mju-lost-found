import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const isCurrentlySuspended = vi.fn();
const getLostPost = vi.fn();
const getFoundPost = vi.fn();
const createSignedUploadUrl = vi.fn();

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/auth/suspension", () => ({ isCurrentlySuspended }));
vi.mock("@/lib/posts/service", () => ({ getLostPost, getFoundPost }));
// Mocked wholesale (see route.test.ts elsewhere) so this never loads the
// real @/lib/posts/http.ts, which imports next-auth through
// @/lib/auth/session -- next-auth doesn't resolve under Vitest's plain
// Node ESM outside of Next's own bundler.
vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response };
});
vi.mock("@/lib/images/supabaseAdmin", () => ({ createSignedUploadUrl }));

const { POST } = await import("./route");

const readyUser = { id: 1, nickname: "닉네임", isSuspended: false, suspendedUntil: null };

function requestWith(body: unknown) {
  return new NextRequest("http://localhost/api/upload", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function callAndGetJson(body: unknown) {
  const res = await POST(requestWith(body));
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  isCurrentlySuspended.mockReturnValue(false);
});

describe("POST /api/upload", () => {
  it("rejects an unauthenticated request", async () => {
    getCurrentUser.mockResolvedValueOnce(null);

    const { status, json } = await callAndGetJson({
      postType: "lost",
      postId: 1,
      contentType: "image/jpeg",
    });

    expect(status).toBe(401);
    expect(json.error).toMatch(/로그인/);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects a user who hasn't set a nickname yet", async () => {
    getCurrentUser.mockResolvedValueOnce({ ...readyUser, nickname: null });

    const { status } = await callAndGetJson({ postType: "lost", postId: 1, contentType: "image/jpeg" });

    expect(status).toBe(403);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects a suspended user", async () => {
    getCurrentUser.mockResolvedValueOnce(readyUser);
    isCurrentlySuspended.mockReturnValueOnce(true);

    const { status, json } = await callAndGetJson({
      postType: "lost",
      postId: 1,
      contentType: "image/jpeg",
    });

    expect(status).toBe(403);
    expect(json.error).toMatch(/정지된 계정/);
  });

  it("rejects an unsupported content type", async () => {
    getCurrentUser.mockResolvedValueOnce(readyUser);

    const { status } = await callAndGetJson({ postType: "lost", postId: 1, contentType: "image/gif" });

    expect(status).toBe(400);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects an upload for a post the user doesn't own", async () => {
    getCurrentUser.mockResolvedValueOnce(readyUser);
    getLostPost.mockResolvedValueOnce({ author: { id: 999 } });

    const { status, json } = await callAndGetJson({
      postType: "lost",
      postId: 1,
      contentType: "image/jpeg",
    });

    expect(status).toBe(403);
    expect(json.error).toMatch(/본인 게시물/);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects a request for a post that doesn't exist", async () => {
    getCurrentUser.mockResolvedValueOnce(readyUser);
    getLostPost.mockResolvedValueOnce(null);

    const { status } = await callAndGetJson({ postType: "lost", postId: 999, contentType: "image/jpeg" });

    expect(status).toBe(403);
  });

  it("mints a signed upload URL for the owner's own post", async () => {
    getCurrentUser.mockResolvedValueOnce(readyUser);
    getLostPost.mockResolvedValueOnce({ author: { id: 1 } });
    createSignedUploadUrl.mockResolvedValueOnce({ path: "posts/lost/1/uuid.jpg", token: "tok" });

    const { status, json } = await callAndGetJson({
      postType: "lost",
      postId: 1,
      contentType: "image/jpeg",
    });

    expect(status).toBe(200);
    expect(json.data).toEqual({ path: "posts/lost/1/uuid.jpg", token: "tok" });
    expect(createSignedUploadUrl).toHaveBeenCalledWith(expect.stringMatching(/^posts\/lost\/1\//));
  });

  it("dispatches to found-post ownership checks for postType=found", async () => {
    getCurrentUser.mockResolvedValueOnce(readyUser);
    getFoundPost.mockResolvedValueOnce({ author: { id: 1 } });
    createSignedUploadUrl.mockResolvedValueOnce({ path: "posts/found/1/uuid.jpg", token: "tok" });

    const { status } = await callAndGetJson({ postType: "found", postId: 1, contentType: "image/png" });

    expect(status).toBe(200);
    expect(getLostPost).not.toHaveBeenCalled();
  });

  it("returns a 502 when Supabase fails to mint the URL", async () => {
    getCurrentUser.mockResolvedValueOnce(readyUser);
    getLostPost.mockResolvedValueOnce({ author: { id: 1 } });
    createSignedUploadUrl.mockRejectedValueOnce(new Error("network error"));

    const { status, json } = await callAndGetJson({
      postType: "lost",
      postId: 1,
      contentType: "image/jpeg",
    });

    expect(status).toBe(502);
    expect(json.error).toBeTruthy();
  });
});
