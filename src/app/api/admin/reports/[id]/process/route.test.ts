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

  // Phase F-2: same 1~365 cap as admin/users/[id]/route -- both suspend
  // paths share the identical duration contract (see moderation/schema.ts's
  // processReportSchema).
  it.each([
    ["366 (over the max)", 366],
    ["0 (not positive)", 0],
    ["-1 (negative)", -1],
    ["1.5 (not an integer)", 1.5],
  ])("rejects suspendDurationDays = %s", async (_label, suspendDurationDays) => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });

    const res = await POST(req({ decision: "action", suspendDurationDays }), params("1"));

    expect(res.status).toBe(400);
    expect(applyReportAction).not.toHaveBeenCalled();
  });

  it("accepts a custom in-range duration outside the fixed presets (e.g. 45 days)", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    getReportTargetType.mockResolvedValueOnce("user");
    applyReportAction.mockResolvedValueOnce({ kind: "ok", data: { id: 1, status: "actioned" } });

    const res = await POST(req({ decision: "action", suspendDurationDays: 45 }), params("1"));

    expect(res.status).toBe(201);
    expect(applyReportAction).toHaveBeenCalledWith(admin, 1, "suspend_user", {
      actionReason: undefined,
      adminNote: undefined,
      suspendDurationDays: 45,
    });
  });

  it("defaults actionType to the report target's own action when none is given", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    getReportTargetType.mockResolvedValueOnce("user");
    applyReportAction.mockResolvedValueOnce({ kind: "ok", data: { id: 1, status: "actioned" } });

    const res = await POST(req({ decision: "action", suspendDurationDays: 30 }), params("1"));

    expect(res.status).toBe(201);
    expect(applyReportAction).toHaveBeenCalledWith(admin, 1, "suspend_user", {
      actionReason: undefined,
      adminNote: undefined,
      suspendDurationDays: 30,
    });
  });

  // Legal pre-beta Phase: a post/comment report may ask for a temporary
  // hide. Whether the requested action is allowed for the report's target
  // (and reason) is decided by applyReportAction() -- a mismatch like
  // delete_post on a user report comes back as invalid_action_type (400).
  it("forwards a requested actionType for the service to check", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    getReportTargetType.mockResolvedValueOnce("user");
    applyReportAction.mockResolvedValueOnce({ kind: "invalid_action_type" });

    const res = await POST(req({ decision: "action", actionType: "delete_post" }), params("1"));

    expect(res.status).toBe(400);
    expect(applyReportAction).toHaveBeenCalledWith(admin, 1, "delete_post", expect.any(Object));
  });

  it("rejects an actionType that isn't a selectable action (restore_* is never chosen here)", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });

    const res = await POST(req({ decision: "action", actionType: "restore_post" }), params("1"));

    expect(res.status).toBe(400);
    expect(applyReportAction).not.toHaveBeenCalled();
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

  // Phase 관리자 승인제: same "우회 차단" HTTP contract as
  // admin/users/[id]/route's own identical test -- when the reported user
  // is an admin, applyReportAction() creates an AdminActionProposal
  // instead of suspending directly, and this route must surface that as
  // 202 (never 201/200), regardless of how the request was made.
  it("returns 202 with the proposal (never 201) when the reported user is an admin", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    getReportTargetType.mockResolvedValueOnce("user");
    applyReportAction.mockResolvedValueOnce({
      kind: "proposal_created",
      data: { id: 42, actionType: "suspend_user", status: "pending" },
    });

    const res = await POST(
      req({ decision: "action", actionReasonCategory: "욕설/비방", actionReason: "반복적인 욕설" }),
      params("1"),
    );
    const json = await res.json();

    expect(res.status).toBe(202);
    expect(json.data).toEqual({ id: 42, actionType: "suspend_user", status: "pending" });
  });
});
