import { beforeEach, describe, expect, it, vi } from "vitest";
const officer = vi.fn(), grant = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { institutionOfficer: { findUnique: officer }, adminPermissionGrant: { findFirst: grant } } }));
const { classifyActor } = await import("./audience");
beforeEach(() => { officer.mockResolvedValue(null); grant.mockResolvedValue(null); });
describe("event-time roles", () => {
  it("keeps external login approval and organization roles outside item authority", async () => {
    expect((await classifyActor({ id: 1, isAdmin: false, userType: "EXTERNAL_VERIFIED" })).role).toBe("member");
    expect((await classifyActor({ id: 1, isAdmin: false })).role).toBe("member");
  });
  it("assigns service precedence when both roles exist, without duplicate events", async () => {
    officer.mockResolvedValue({ active: true, organizationId: 2, organization: { status: "ACTIVE", managementCampus: "양쪽" } });
    grant.mockResolvedValue({ userId: 1 });
    expect(await classifyActor({ id: 1, isAdmin: true })).toEqual({ audience: "internal", role: "service", organizationId: 2 });
    expect((await classifyActor({ id: 1, isAdmin: false })).role).toBe("officer");
    // an agency scope alone is not a permission; revoking every permission makes the account a member again
    grant.mockResolvedValue(null);
    expect((await classifyActor({ id: 1, isAdmin: false })).role).toBe("member");
  });
  it("treats any one permission as management activity, and several permissions are still one actor", async () => {
    grant.mockResolvedValue({ userId: 1 });
    expect(await classifyActor({ id: 1, isAdmin: false })).toEqual({ audience: "internal", role: "officer", organizationId: null });
    expect(grant).toHaveBeenCalledTimes(1);
  });
  it("does not assert that test accounts are verified administrators or ordinary members", async () => { expect((await classifyActor({ id: 1, isAdmin: false, userType: "EXTERNAL_TEST" })).audience).toBe("unclassified"); });
});
