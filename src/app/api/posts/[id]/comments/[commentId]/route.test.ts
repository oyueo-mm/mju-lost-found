import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const updateComment = vi.fn();
const deleteComment = vi.fn();

vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireUserForApi };
});
vi.mock("@/lib/comment/service", () => ({ updateComment, deleteComment }));

const { PATCH, DELETE } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };
const params = (commentId: string) => ({ params: Promise.resolve({ id: "1", commentId }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/posts/[id]/comments/[commentId]", () => {
  it("requires login", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });
    const res = await PATCH(
      new NextRequest("http://localhost/api/posts/1/comments/10", {
        method: "PATCH",
        body: JSON.stringify({ content: "수정" }),
      }),
      params("10"),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a non-owner with 403", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    updateComment.mockResolvedValueOnce({ kind: "forbidden", reason: "not_owner" });

    const res = await PATCH(
      new NextRequest("http://localhost/api/posts/1/comments/10", {
        method: "PATCH",
        body: JSON.stringify({ content: "수정" }),
      }),
      params("10"),
    );

    expect(res.status).toBe(403);
  });

  it("updates the comment for the owner", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    updateComment.mockResolvedValueOnce({
      kind: "ok",
      data: { id: 10, content: "수정된 댓글", createdAt: new Date(), updatedAt: new Date(), author: sessionUser },
    });

    const res = await PATCH(
      new NextRequest("http://localhost/api/posts/1/comments/10", {
        method: "PATCH",
        body: JSON.stringify({ content: "수정된 댓글" }),
      }),
      params("10"),
    );

    expect(res.status).toBe(200);
    expect(updateComment).toHaveBeenCalledWith(1, 10, { content: "수정된 댓글" });
  });
});

describe("DELETE /api/posts/[id]/comments/[commentId]", () => {
  it("requires login", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });
    const res = await DELETE(new NextRequest("http://localhost/api/posts/1/comments/10", { method: "DELETE" }), params("10"));
    expect(res.status).toBe(401);
  });

  it("rejects a non-owner, non-admin with 403", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    deleteComment.mockResolvedValueOnce({ kind: "forbidden", reason: "not_owner" });

    const res = await DELETE(new NextRequest("http://localhost/api/posts/1/comments/10", { method: "DELETE" }), params("10"));

    expect(res.status).toBe(403);
  });

  it("allows the owner to delete", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    deleteComment.mockResolvedValueOnce({ kind: "ok", data: { id: 10 } });

    const res = await DELETE(new NextRequest("http://localhost/api/posts/1/comments/10", { method: "DELETE" }), params("10"));

    expect(res.status).toBe(200);
    expect(deleteComment).toHaveBeenCalledWith(sessionUser, 10);
  });
});
