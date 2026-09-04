import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const createReport = vi.fn();
const listReportsForUser = vi.fn();

vi.mock("@/lib/report/http", async () => {
  const response = await import("@/lib/posts/response");
  const reportResponse = await import("@/lib/report/response");
  return { ...response, ...reportResponse, requireUserForApi };
});
vi.mock("@/lib/report/service", () => ({ createReport, listReportsForUser }));

const { GET, POST } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/reports", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(listReportsForUser).not.toHaveBeenCalled();
  });

  it("returns only the current user's own reports", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    listReportsForUser.mockResolvedValueOnce([{ id: 1 }]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([{ id: 1 }]);
    expect(listReportsForUser).toHaveBeenCalledWith(sessionUser.id);
  });
});

describe("POST /api/reports", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await POST(
      new NextRequest("http://localhost/api/reports", {
        method: "POST",
        body: JSON.stringify({ targetType: "post", targetId: 1, reason: "기타" }),
      }),
    );

    expect(res.status).toBe(401);
    expect(createReport).not.toHaveBeenCalled();
  });

  it("rejects an invalid body (400), never reaching the service", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });

    const res = await POST(
      new NextRequest("http://localhost/api/reports", { method: "POST", body: JSON.stringify({}) }),
    );

    expect(res.status).toBe(400);
    expect(createReport).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent target", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    createReport.mockResolvedValueOnce({ kind: "target_not_found" });

    const res = await POST(
      new NextRequest("http://localhost/api/reports", {
        method: "POST",
        body: JSON.stringify({ targetType: "post", targetId: 999, reason: "기타" }),
      }),
    );

    expect(res.status).toBe(404);
  });

  it("returns 400 for a self-report", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    createReport.mockResolvedValueOnce({ kind: "self_report" });

    const res = await POST(
      new NextRequest("http://localhost/api/reports", {
        method: "POST",
        body: JSON.stringify({ targetType: "user", targetId: sessionUser.id, reason: "기타" }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("returns 409 for a duplicate report", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    createReport.mockResolvedValueOnce({ kind: "duplicate" });

    const res = await POST(
      new NextRequest("http://localhost/api/reports", {
        method: "POST",
        body: JSON.stringify({ targetType: "post", targetId: 5, reason: "기타" }),
      }),
    );

    expect(res.status).toBe(409);
  });

  it("files the report as the authenticated session user, never any reporterId in the body", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    createReport.mockResolvedValueOnce({ kind: "ok", data: { id: 1 } });

    const res = await POST(
      new NextRequest("http://localhost/api/reports", {
        method: "POST",
        body: JSON.stringify({ targetType: "post", targetId: 5, reason: "기타", reporterId: 999 }),
      }),
    );

    expect(res.status).toBe(201);
    expect(createReport).toHaveBeenCalledWith(
      sessionUser,
      expect.objectContaining({ targetType: "post", targetId: 5, reason: "기타" }),
    );
  });
});
