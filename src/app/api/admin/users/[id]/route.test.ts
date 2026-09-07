import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireAdminForApi = vi.fn();
const updateUserByAdmin = vi.fn();

vi.mock("@/lib/moderation/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireAdminForApi };
});
vi.mock("@/lib/admin/users", () => ({ updateUserByAdmin }));

const { PATCH } = await import("./route");

const admin = { id: 1, isAdmin: true };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/admin/users/[id]", () => {
  it("rejects an unauthenticated request", async () => {
    requireAdminForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/users/5", {
        method: "PATCH",
        body: JSON.stringify({ action: "promote" }),
      }),
      params("5"),
    );

    expect(res.status).toBe(401);
    expect(updateUserByAdmin).not.toHaveBeenCalled();
  });

  it("rejects a non-admin request with 403", async () => {
    requireAdminForApi.mockResolvedValueOnce({ response: jsonError(403, "관리자 권한이 필요합니다.") });

    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/users/5", {
        method: "PATCH",
        body: JSON.stringify({ action: "promote" }),
      }),
      params("5"),
    );

    expect(res.status).toBe(403);
  });

  it("rejects an invalid id", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });

    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/users/abc", {
        method: "PATCH",
        body: JSON.stringify({ action: "promote" }),
      }),
      params("abc"),
    );

    expect(res.status).toBe(400);
    expect(updateUserByAdmin).not.toHaveBeenCalled();
  });

  it("rejects an invalid action", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });

    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/users/5", {
        method: "PATCH",
        body: JSON.stringify({ action: "delete" }),
      }),
      params("5"),
    );

    expect(res.status).toBe(400);
    expect(updateUserByAdmin).not.toHaveBeenCalled();
  });

  it("returns 400 when the service rejects a self-target action", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    updateUserByAdmin.mockResolvedValueOnce({ kind: "self" });

    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/users/1", {
        method: "PATCH",
        body: JSON.stringify({ action: "demote" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 for a nonexistent target user", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    updateUserByAdmin.mockResolvedValueOnce({ kind: "not_found" });

    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/users/999", {
        method: "PATCH",
        body: JSON.stringify({ action: "promote" }),
      }),
      params("999"),
    );

    expect(res.status).toBe(404);
  });

  // Phase F-2: suspendDurationDays now has an upper bound (max 365) so an
  // admin can't pass an effectively-permanent duration (e.g. 999999) that
  // bypasses the deliberate "no duration = permanent" convention.
  it.each([
    ["366 (over the max)", 366],
    ["0 (not positive)", 0],
    ["-1 (negative)", -1],
    ["1.5 (not an integer)", 1.5],
  ])("rejects suspendDurationDays = %s", async (_label, suspendDurationDays) => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });

    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/users/5", {
        method: "PATCH",
        body: JSON.stringify({ action: "suspend", suspendDurationDays }),
      }),
      params("5"),
    );

    expect(res.status).toBe(400);
    expect(updateUserByAdmin).not.toHaveBeenCalled();
  });

  it("accepts suspendDurationDays = 365 (the max)", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    updateUserByAdmin.mockResolvedValueOnce({ kind: "ok", data: { id: 5, isSuspended: true } });

    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/users/5", {
        method: "PATCH",
        body: JSON.stringify({ action: "suspend", suspendDurationDays: 365 }),
      }),
      params("5"),
    );

    expect(res.status).toBe(200);
    expect(updateUserByAdmin).toHaveBeenCalledWith(admin, 5, "suspend", 365);
  });

  it("promotes the target user and forwards suspendDurationDays when given", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: admin });
    updateUserByAdmin.mockResolvedValueOnce({ kind: "ok", data: { id: 5, isSuspended: true } });

    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/users/5", {
        method: "PATCH",
        body: JSON.stringify({ action: "suspend", suspendDurationDays: 7 }),
      }),
      params("5"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(updateUserByAdmin).toHaveBeenCalledWith(admin, 5, "suspend", 7);
    expect(json.data.id).toBe(5);
  });
});
