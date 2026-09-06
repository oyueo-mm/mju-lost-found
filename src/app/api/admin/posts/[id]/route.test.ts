import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireAdminForApi = vi.fn();
const deletePostForAdmin = vi.fn();

vi.mock("@/lib/moderation/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireAdminForApi };
});
vi.mock("@/lib/admin/posts", () => ({ deletePostForAdmin }));

const { DELETE } = await import("./route");

const admin = { id: 1, isAdmin: true };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/admin/posts/[id]", () => {
  it("rejects an unauthenticated request", async () => {
    requireAdminForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await DELETE(
      new NextRequest("http://localhost/api/admin/posts/1?type=lost", { method: "DELETE" }),
      params("1"),
    );

    expect(res.status).toBe(401);
    expect(deletePostForAdmin).not.toHaveBeenCalled();
  });

  it("rejects a non-admin request with 403 -- a regular user can never delete via this route", async () => {
    requireAdminForApi.mockResolvedValueOnce({ response: jsonError(403, "관리자 권한이 필요합니다.") });

    const res = await DELETE(
      new NextRequest("http://localhost/api/admin/posts/1?type=lost", { method: "DELETE" }),
      params("1"),
    );

    expect(res.status).toBe(403);
    expect(deletePostForAdmin).not.toHaveBeenCalled();
  });

  it("rejects an invalid id/type combination", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });

    const res = await DELETE(
      new NextRequest("http://localhost/api/admin/posts/1?type=bogus", { method: "DELETE" }),
      params("1"),
    );

    expect(res.status).toBe(400);
    expect(deletePostForAdmin).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent post", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    deletePostForAdmin.mockResolvedValueOnce({ kind: "not_found" });

    const res = await DELETE(
      new NextRequest("http://localhost/api/admin/posts/999?type=lost", { method: "DELETE" }),
      params("999"),
    );

    expect(res.status).toBe(404);
  });

  it("deletes the post for the admin, regardless of who owns it", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    deletePostForAdmin.mockResolvedValueOnce({ kind: "ok", data: { id: 5 } });

    const res = await DELETE(
      new NextRequest("http://localhost/api/admin/posts/5?type=found", { method: "DELETE" }),
      params("5"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(deletePostForAdmin).toHaveBeenCalledWith(admin, "found", 5);
    expect(json.data).toEqual({ id: 5 });
  });
});
