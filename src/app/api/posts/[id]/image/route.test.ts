import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const setPostImage = vi.fn();
const clearPostImage = vi.fn();

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
});

describe("POST /api/posts/[id]/image", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await POST(
      new NextRequest("http://localhost/api/posts/1/image?type=lost", {
        method: "POST",
        body: JSON.stringify({ url: "https://x/y.jpg", pathname: "posts/lost/1/y.jpg" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(401);
    expect(setPostImage).not.toHaveBeenCalled();
  });

  it("rejects an arbitrary external URL that never went through our upload flow", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    setPostImage.mockResolvedValueOnce({ kind: "invalid_url" });

    const res = await POST(
      new NextRequest("http://localhost/api/posts/1/image?type=lost", {
        method: "POST",
        body: JSON.stringify({ url: "https://attacker.example/fake.jpg", pathname: "whatever" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(400);
  });

  it("rejects changing someone else's post image", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    setPostImage.mockResolvedValueOnce({ kind: "forbidden" });

    const res = await POST(
      new NextRequest("http://localhost/api/posts/1/image?type=lost", {
        method: "POST",
        body: JSON.stringify({ url: "https://x/y.jpg", pathname: "posts/lost/1/y.jpg" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(403);
  });

  it("attaches the image for the owner", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    setPostImage.mockResolvedValueOnce({ kind: "ok", data: { imageUrl: "https://x/y.jpg" } });

    const res = await POST(
      new NextRequest("http://localhost/api/posts/1/image?type=lost", {
        method: "POST",
        body: JSON.stringify({ url: "https://x/y.jpg", pathname: "posts/lost/1/y.jpg" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(200);
    expect(setPostImage).toHaveBeenCalledWith("lost", 1, sessionUser.id, {
      url: "https://x/y.jpg",
      pathname: "posts/lost/1/y.jpg",
    });
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
