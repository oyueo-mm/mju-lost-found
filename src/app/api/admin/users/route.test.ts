import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireAdminForApi = vi.fn();
const listUsersForAdmin = vi.fn();

vi.mock("@/lib/moderation/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireAdminForApi };
});
vi.mock("@/lib/admin/users", () => ({ listUsersForAdmin }));

const { GET } = await import("./route");

const admin = { id: 1, isAdmin: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/users", () => {
  it("rejects an unauthenticated request", async () => {
    requireAdminForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await GET(new NextRequest("http://localhost/api/admin/users"));

    expect(res.status).toBe(401);
    expect(listUsersForAdmin).not.toHaveBeenCalled();
  });

  it("rejects a non-admin request with 403", async () => {
    requireAdminForApi.mockResolvedValueOnce({ response: jsonError(403, "관리자 권한이 필요합니다.") });

    const res = await GET(new NextRequest("http://localhost/api/admin/users"));

    expect(res.status).toBe(403);
    expect(listUsersForAdmin).not.toHaveBeenCalled();
  });

  it("returns the user list for an admin, with parsed query", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    listUsersForAdmin.mockResolvedValueOnce({
      kind: "ok",
      data: { items: [{ id: 5 }], page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await GET(new NextRequest("http://localhost/api/admin/users?q=target&page=1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.items).toEqual([{ id: 5 }]);
    expect(listUsersForAdmin).toHaveBeenCalledWith(admin, expect.objectContaining({ q: "target", page: 1 }));
  });
});
