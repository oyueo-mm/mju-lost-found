import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const approveOrganizationCreationRequest = vi.fn();
const rejectOrganizationCreationRequest = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireAdmin }));
vi.mock("@/lib/organization/service", () => ({ approveOrganizationCreationRequest, rejectOrganizationCreationRequest }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { approveOrganizationCreationRequestAction, rejectOrganizationCreationRequestAction } = await import("./actions");

const admin = { id: 1, isAdmin: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("approveOrganizationCreationRequestAction", () => {
  it("calls requireAdmin() before doing anything else", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(approveOrganizationCreationRequestAction(100)).rejects.toThrow();

    expect(approveOrganizationCreationRequest).not.toHaveBeenCalled();
  });

  it("returns an error for a nonexistent request", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    approveOrganizationCreationRequest.mockResolvedValueOnce({ kind: "not_found" });

    const result = await approveOrganizationCreationRequestAction(999);

    expect(result).toEqual({ error: expect.any(String) });
  });

  it("returns an error for an already-processed request", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    approveOrganizationCreationRequest.mockResolvedValueOnce({ kind: "invalid_state" });

    const result = await approveOrganizationCreationRequestAction(100);

    expect(result).toEqual({ error: expect.any(String) });
  });

  it("approves and revalidates both the list and detail page", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    approveOrganizationCreationRequest.mockResolvedValueOnce({ kind: "ok", data: { organizationId: 20 } });

    const result = await approveOrganizationCreationRequestAction(100, { adminNote: "확인 완료" });

    expect(result).toEqual({ ok: true, organizationId: 20 });
    expect(approveOrganizationCreationRequest).toHaveBeenCalledWith(admin, 100, { adminNote: "확인 완료" });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/organization-requests");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/organization-requests/100");
  });

  it("approves with no adminNote at all", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    approveOrganizationCreationRequest.mockResolvedValueOnce({ kind: "ok", data: { organizationId: 20 } });

    await approveOrganizationCreationRequestAction(100);

    expect(approveOrganizationCreationRequest).toHaveBeenCalledWith(admin, 100, {});
  });
});

describe("rejectOrganizationCreationRequestAction", () => {
  it("calls requireAdmin() before doing anything else", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(rejectOrganizationCreationRequestAction(100, { rejectionReason: "사유" })).rejects.toThrow();

    expect(rejectOrganizationCreationRequest).not.toHaveBeenCalled();
  });

  // §11: "거절에는 반드시 사유를 받는다" -- 서버(zod)가 재검증.
  it("rejects an empty rejectionReason before calling the service", async () => {
    requireAdmin.mockResolvedValueOnce(admin);

    const result = await rejectOrganizationCreationRequestAction(100, { rejectionReason: "  " });

    expect(result).toEqual({ error: expect.any(String) });
    expect(rejectOrganizationCreationRequest).not.toHaveBeenCalled();
  });

  it("returns an error for an already-processed request", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    rejectOrganizationCreationRequest.mockResolvedValueOnce({ kind: "invalid_state" });

    const result = await rejectOrganizationCreationRequestAction(100, { rejectionReason: "정보 부족" });

    expect(result).toEqual({ error: expect.any(String) });
  });

  it("rejects and revalidates both the list and detail page", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    rejectOrganizationCreationRequest.mockResolvedValueOnce({ kind: "ok", data: { id: 100 } });

    const result = await rejectOrganizationCreationRequestAction(100, { rejectionReason: "정보 부족" });

    expect(result).toEqual({ ok: true });
    expect(rejectOrganizationCreationRequest).toHaveBeenCalledWith(admin, 100, { rejectionReason: "정보 부족" });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/organization-requests");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/organization-requests/100");
  });
});
