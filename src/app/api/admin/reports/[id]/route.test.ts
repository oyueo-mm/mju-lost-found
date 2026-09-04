import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireAdminForApi = vi.fn();
const getReportForAdmin = vi.fn();

vi.mock("@/lib/moderation/http", async () => {
  const response = await import("@/lib/posts/response");
  const modResponse = await import("@/lib/moderation/response");
  return { ...response, ...modResponse, requireAdminForApi };
});
vi.mock("@/lib/moderation/service", () => ({ getReportForAdmin }));

const { GET } = await import("./route");

const admin = { id: 1, isAdmin: true };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/reports/[id]", () => {
  it("rejects an unauthenticated request", async () => {
    requireAdminForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await GET(new NextRequest("http://localhost/api/admin/reports/1"), params("1"));

    expect(res.status).toBe(401);
    expect(getReportForAdmin).not.toHaveBeenCalled();
  });

  it("rejects a non-admin request with 403", async () => {
    requireAdminForApi.mockResolvedValueOnce({ response: jsonError(403, "관리자 권한이 필요합니다.") });

    const res = await GET(new NextRequest("http://localhost/api/admin/reports/1"), params("1"));

    expect(res.status).toBe(403);
  });

  it("returns 404 for a nonexistent report", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    getReportForAdmin.mockResolvedValueOnce({ kind: "not_found" });

    const res = await GET(new NextRequest("http://localhost/api/admin/reports/999"), params("999"));

    expect(res.status).toBe(404);
  });

  it("returns the report detail for an admin", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    getReportForAdmin.mockResolvedValueOnce({ kind: "ok", data: { id: 1 } });

    const res = await GET(new NextRequest("http://localhost/api/admin/reports/1"), params("1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe(1);
    expect(getReportForAdmin).toHaveBeenCalledWith(admin, 1);
  });
});
