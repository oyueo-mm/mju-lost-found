import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const setOrganizationStatusForAdmin = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireAdmin }));
vi.mock("@/lib/organization/service", () => ({ setOrganizationStatusForAdmin }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { setOrganizationStatusAction } = await import("./actions");

const admin = { id: 1, isAdmin: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setOrganizationStatusAction", () => {
  it("calls requireAdmin() before doing anything else", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(setOrganizationStatusAction(10, "inactive")).rejects.toThrow();
    expect(setOrganizationStatusForAdmin).not.toHaveBeenCalled();
  });

  it("returns an error for a nonexistent organization", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    setOrganizationStatusForAdmin.mockResolvedValueOnce({ kind: "not_found" });
    const result = await setOrganizationStatusAction(999, "inactive");
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("returns an error for forbidden (e.g. session revoked mid-flight)", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    setOrganizationStatusForAdmin.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await setOrganizationStatusAction(10, "inactive");
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("returns an error for an already-target-state organization (invalid_state)", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    setOrganizationStatusForAdmin.mockResolvedValueOnce({ kind: "invalid_state" });
    const result = await setOrganizationStatusAction(10, "inactive");
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("deactivates and revalidates admin list/detail + the user-facing profile page", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    setOrganizationStatusForAdmin.mockResolvedValueOnce({ kind: "ok", data: { id: 10 } });

    const result = await setOrganizationStatusAction(10, "inactive");

    expect(result).toEqual({ ok: true });
    expect(setOrganizationStatusForAdmin).toHaveBeenCalledWith(admin, 10, "inactive");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/organizations");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/organizations/10");
    expect(revalidatePath).toHaveBeenCalledWith("/organizations/10");
  });

  it("reactivates an INACTIVE organization", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    setOrganizationStatusForAdmin.mockResolvedValueOnce({ kind: "ok", data: { id: 10 } });

    const result = await setOrganizationStatusAction(10, "active");

    expect(result).toEqual({ ok: true });
    expect(setOrganizationStatusForAdmin).toHaveBeenCalledWith(admin, 10, "active");
  });
});
