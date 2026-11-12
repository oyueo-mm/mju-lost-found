import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserForApi = vi.fn();
vi.mock("@/lib/posts/http", () => ({ requireUserForApi, jsonError: (status: number, error: string) => ({ status, error }), jsonOk: vi.fn(), withErrorHandling: vi.fn() }));
vi.mock("./response", () => ({ adminMutationResultToResponse: vi.fn() }));
const { requireAdminForApi } = await import("./http");

const as = (user: object) => requireUserForApi.mockResolvedValue({ user });
beforeEach(() => vi.clearAllMocks());

describe("requireAdminForApi(permission)", () => {
  it("rejects an account without the permission, even one holding other permissions", async () => {
    as({ id: 2, isAdmin: false, adminPermissions: ["reports.view", "users.view"] });
    expect(await requireAdminForApi("reports.process")).toEqual({ response: { status: 403, error: "관리자 권한이 필요합니다." } });
    expect(await requireAdminForApi("stats.users")).toHaveProperty("response");
  });
  it("accepts the permission, and any one of several", async () => {
    as({ id: 2, isAdmin: false, adminPermissions: ["posts.delete"] });
    expect(await requireAdminForApi("posts.delete")).toHaveProperty("user");
    expect(await requireAdminForApi(["posts.manage", "posts.delete"])).toHaveProperty("user");
    expect(await requireAdminForApi("posts.manage")).toHaveProperty("response");
  });
  it("without a permission argument only a full administrator passes", async () => {
    as({ id: 2, isAdmin: false, adminPermissions: ["reports.view"] });
    expect(await requireAdminForApi()).toHaveProperty("response");
    as({ id: 1, isAdmin: true, adminPermissions: [] });
    expect(await requireAdminForApi()).toHaveProperty("user");
  });
  it("refuses a suspended account with or without a permission argument (H-1)", async () => {
    const until = new Date(Date.now() + 3600 * 1000);
    as({ id: 1, isAdmin: true, adminPermissions: [], isSuspended: true, suspendedUntil: null });
    expect(await requireAdminForApi()).toEqual({ response: { status: 403, error: "관리자 권한이 필요합니다." } });
    expect(await requireAdminForApi("reports.view")).toHaveProperty("response");
    as({ id: 2, isAdmin: false, adminPermissions: ["reports.view", "users.view", "users.sanction"], isSuspended: true, suspendedUntil: until });
    expect(await requireAdminForApi("reports.view")).toHaveProperty("response");
    expect(await requireAdminForApi(["users.sanction", "permissions.manage"])).toHaveProperty("response");
    // the same officer once the suspension has ended
    as({ id: 2, isAdmin: false, adminPermissions: ["reports.view"], isSuspended: true, suspendedUntil: new Date(Date.now() - 1000) });
    expect(await requireAdminForApi("reports.view")).toHaveProperty("user");
  });
  it("passes a 401/403 from the login check straight through, and a regular user never passes", async () => {
    requireUserForApi.mockResolvedValue({ response: { status: 401 } });
    expect(await requireAdminForApi("reports.view")).toEqual({ response: { status: 401 } });
    as({ id: 3, isAdmin: false, adminPermissions: [] });
    expect(await requireAdminForApi("reports.view")).toHaveProperty("response");
  });
});
