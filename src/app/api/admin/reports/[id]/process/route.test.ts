import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireAdminForApi = vi.fn();
const dismissReport = vi.fn();
const applyReportAction = vi.fn();
const getReportTargetType = vi.fn();

vi.mock("@/lib/moderation/http", async () => {
  const response = await import("@/lib/posts/response");
  const modResponse = await import("@/lib/moderation/response");
  return { ...response, ...modResponse, requireAdminForApi };
});
vi.mock("@/lib/moderation/service", () => ({ dismissReport, applyReportAction, getReportTargetType }));

const { POST } = await import("./route");

const admin = { id: 1, isAdmin: true };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function req(body: unknown) {
  return new NextRequest("http://localhost/api/admin/reports/1/process", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/reports/[id]/process", () => {
  it("rejects an unauthenticated request", async () => {
    requireAdminForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await POST(req({ decision: "dismiss" }), params("1"));

    expect(res.status).toBe(401);
    expect(dismissReport).not.toHaveBeenCalled();
  });

  it("rejects a non-admin request with 403", async () => {
    requireAdminForApi.mockResolvedValueOnce({ response: jsonError(403, "관리자 권한이 필요합니다.") });

    const res = await POST(req({ decision: "dismiss" }), params("1"));

    expect(res.status).toBe(403);
  });

  it("rejects an invalid body", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });

    const res = await POST(req({ decision: "unknown" }), params("1"));

    expect(res.status).toBe(400);
    expect(dismissReport).not.toHaveBeenCalled();
    expect(applyReportAction).not.toHaveBeenCalled();
  });

  it("dismisses using the authenticated admin, never an adminUserId from the body", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    dismissReport.mockResolvedValueOnce({ kind: "ok", data: { id: 1, status: "dismissed" } });

    const res = await POST(req({ decision: "dismiss", adminNote: "메모", adminUserId: 999 }), params("1"));

    expect(res.status).toBe(200);
    expect(dismissReport).toHaveBeenCalledWith(admin, 1, "메모");
  });

  it("returns 409 when dismissing an already-processed report", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    dismissReport.mockResolvedValueOnce({ kind: "already_processed" });

    const res = await POST(req({ decision: "dismiss" }), params("1"));

    expect(res.status).toBe(409);
  });

  it("returns 404 for an action decision on a nonexistent report", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    getReportTargetType.mockResolvedValueOnce(null);

    const res = await POST(req({ decision: "action" }), params("999"));

    expect(res.status).toBe(404);
    expect(applyReportAction).not.toHaveBeenCalled();
  });

  it("derives actionType server-side from the report's own target type, never from the request body", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    getReportTargetType.mockResolvedValueOnce("user");
    applyReportAction.mockResolvedValueOnce({ kind: "ok", data: { id: 1, status: "actioned" } });

    const res = await POST(
      req({ decision: "action", actionType: "delete_post", suspendDurationDays: 30 }),
      params("1"),
    );

    expect(res.status).toBe(201);
    expect(applyReportAction).toHaveBeenCalledWith(admin, 1, "suspend_user", {
      actionReason: undefined,
      adminNote: undefined,
      suspendDurationDays: 30,
    });
  });

  it("returns 400 when the resolved action_type doesn't match the target (service-level mismatch)", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    getReportTargetType.mockResolvedValueOnce("post");
    applyReportAction.mockResolvedValueOnce({ kind: "invalid_action_type" });

    const res = await POST(req({ decision: "action" }), params("1"));

    expect(res.status).toBe(400);
  });

  it("returns 409 when the target is already gone", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    getReportTargetType.mockResolvedValueOnce("post");
    applyReportAction.mockResolvedValueOnce({ kind: "target_gone" });

    const res = await POST(req({ decision: "action" }), params("1"));

    expect(res.status).toBe(409);
  });
});
