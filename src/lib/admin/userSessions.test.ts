import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const revokeAllSessions = vi.fn(async () => new Date("2026-11-22T00:00:00Z"));
const recordAdminActivity = vi.fn(async () => true);
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { findUnique } } }));
vi.mock("@/lib/auth/sessionRevocation", () => ({ revokeAllSessions }));
vi.mock("@/lib/admin/activityLog", () => ({ recordAdminActivity }));

const { revokeUserSessionsByAdmin } = await import("./userSessions");

const base = { isSuspended: false, suspendedUntil: null };
const sanctionAdmin = { ...base, id: 1, isAdmin: false, adminPermissions: ["users.sanction"] };
const fullAdmin = { ...base, id: 2, isAdmin: true, adminPermissions: [] };
const viewer = { ...base, id: 3, isAdmin: false, adminPermissions: ["users.view"] };

beforeEach(() => {
  findUnique.mockReset();
  revokeAllSessions.mockClear();
  recordAdminActivity.mockClear();
});

describe("revokeUserSessionsByAdmin (P-5)", () => {
  it("ends a member's sessions with users.sanction and records who did it", async () => {
    findUnique.mockResolvedValueOnce({ id: 9, isAdmin: false });
    expect((await revokeUserSessionsByAdmin(sanctionAdmin, 9)).kind).toBe("ok");
    expect(revokeAllSessions).toHaveBeenCalledWith(9);
    expect(recordAdminActivity).toHaveBeenCalledWith(1, "user.sessions_revoke", { type: "user", id: 9 });
  });

  it("refuses without users.sanction and changes nothing", async () => {
    expect((await revokeUserSessionsByAdmin(viewer, 9)).kind).toBe("forbidden");
    expect(findUnique).not.toHaveBeenCalled();
    expect(revokeAllSessions).not.toHaveBeenCalled();
  });

  it("lets only a full administrator sign another administrator out", async () => {
    findUnique.mockResolvedValue({ id: 2, isAdmin: true });
    expect((await revokeUserSessionsByAdmin(sanctionAdmin, 2)).kind).toBe("forbidden");
    expect(revokeAllSessions).not.toHaveBeenCalled();
    findUnique.mockResolvedValue({ id: 5, isAdmin: true });
    expect((await revokeUserSessionsByAdmin(fullAdmin, 5)).kind).toBe("ok");
  });

  it("refuses a suspended full administrator", async () => {
    expect((await revokeUserSessionsByAdmin({ ...fullAdmin, isSuspended: true }, 9)).kind).toBe("forbidden");
  });

  it("answers not_found for a missing user", async () => {
    findUnique.mockResolvedValueOnce(null);
    expect((await revokeUserSessionsByAdmin(sanctionAdmin, 404)).kind).toBe("not_found");
  });
});
