import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const getReportForUser = vi.fn();

vi.mock("@/lib/report/http", async () => {
  const response = await import("@/lib/posts/response");
  const reportResponse = await import("@/lib/report/response");
  return { ...response, ...reportResponse, requireUserForApi };
});
vi.mock("@/lib/report/service", () => ({ getReportForUser }));

const { GET } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/reports/[id]", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await GET(new NextRequest("http://localhost/api/reports/1"), params("1"));

    expect(res.status).toBe(401);
    expect(getReportForUser).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent report", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getReportForUser.mockResolvedValueOnce({ kind: "not_found" });

    const res = await GET(new NextRequest("http://localhost/api/reports/999"), params("999"));

    expect(res.status).toBe(404);
  });

  it("rejects a user who isn't the reporter (A's report id known by B) with 403", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getReportForUser.mockResolvedValueOnce({ kind: "forbidden" });

    const res = await GET(new NextRequest("http://localhost/api/reports/1"), params("1"));

    expect(res.status).toBe(403);
  });

  it("returns the report for its own reporter", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getReportForUser.mockResolvedValueOnce({ kind: "ok", data: { id: 1 } });

    const res = await GET(new NextRequest("http://localhost/api/reports/1"), params("1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe(1);
    expect(getReportForUser).toHaveBeenCalledWith(1, sessionUser.id);
  });
});
