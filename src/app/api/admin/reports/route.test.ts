import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireAdminForApi = vi.fn();
const listReportsForAdmin = vi.fn();

vi.mock("@/lib/moderation/http", async () => {
  const response = await import("@/lib/posts/response");
  const modResponse = await import("@/lib/moderation/response");
  return { ...response, ...modResponse, requireAdminForApi };
});
vi.mock("@/lib/moderation/service", () => ({ listReportsForAdmin }));

const { GET } = await import("./route");

const admin = { id: 1, isAdmin: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/reports", () => {
  it("rejects an unauthenticated request", async () => {
    requireAdminForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await GET(new NextRequest("http://localhost/api/admin/reports"));

    expect(res.status).toBe(401);
    expect(listReportsForAdmin).not.toHaveBeenCalled();
  });

  it("rejects a non-admin request with 403", async () => {
    requireAdminForApi.mockResolvedValueOnce({ response: jsonError(403, "관리자 권한이 필요합니다.") });

    const res = await GET(new NextRequest("http://localhost/api/admin/reports"));

    expect(res.status).toBe(403);
    expect(listReportsForAdmin).not.toHaveBeenCalled();
  });

  it("returns the report queue for an admin, with parsed filters", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    listReportsForAdmin.mockResolvedValueOnce({
      kind: "ok",
      data: { items: [{ id: 1 }], page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await GET(new NextRequest("http://localhost/api/admin/reports?status=pending&targetType=post"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.items).toEqual([{ id: 1 }]);
    expect(listReportsForAdmin).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ status: "pending", targetType: "post", page: 1, limit: 20 }),
    );
  });
});
