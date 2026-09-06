import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireAdminForApi = vi.fn();
const listPostsForAdmin = vi.fn();

vi.mock("@/lib/moderation/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireAdminForApi };
});
vi.mock("@/lib/admin/posts", () => ({ listPostsForAdmin }));

const { GET } = await import("./route");

const admin = { id: 1, isAdmin: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/posts", () => {
  it("rejects an unauthenticated request", async () => {
    requireAdminForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await GET(new NextRequest("http://localhost/api/admin/posts?type=lost"));

    expect(res.status).toBe(401);
    expect(listPostsForAdmin).not.toHaveBeenCalled();
  });

  it("rejects a non-admin request with 403", async () => {
    requireAdminForApi.mockResolvedValueOnce({ response: jsonError(403, "관리자 권한이 필요합니다.") });

    const res = await GET(new NextRequest("http://localhost/api/admin/posts?type=lost"));

    expect(res.status).toBe(403);
    expect(listPostsForAdmin).not.toHaveBeenCalled();
  });

  it("rejects a missing/invalid type without ever calling listPostsForAdmin", async () => {
    // Same schema.parse() (not safeParse()) convention
    // api/admin/reports/route.ts already uses -- an invalid query throws,
    // and withErrorHandling converts that into a non-2xx response rather
    // than a rejected promise.
    requireAdminForApi.mockResolvedValueOnce({ user: admin });

    const res = await GET(new NextRequest("http://localhost/api/admin/posts"));

    expect(res.ok).toBe(false);
    expect(listPostsForAdmin).not.toHaveBeenCalled();
  });

  it("returns the post list for an admin, with parsed query", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    listPostsForAdmin.mockResolvedValueOnce({
      kind: "ok",
      data: { items: [{ id: 1 }], page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await GET(
      new NextRequest("http://localhost/api/admin/posts?type=lost&q=우산&authorQuery=닉네임"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.items).toEqual([{ id: 1 }]);
    expect(listPostsForAdmin).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ type: "lost", q: "우산", authorQuery: "닉네임" }),
    );
  });
});
