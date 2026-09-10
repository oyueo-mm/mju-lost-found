import { beforeEach, describe, expect, it, vi } from "vitest";

const requireActiveUser = vi.fn();
const createOrganizationCreationRequest = vi.fn();
const cancelOrganizationCreationRequest = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireActiveUser }));
vi.mock("@/lib/organization/service", () => ({ createOrganizationCreationRequest, cancelOrganizationCreationRequest }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { createOrganizationCreationRequestAction, cancelOrganizationCreationRequestAction } = await import("./actions");

const user = { id: 2, isAdmin: false };

const validInput = {
  organizationName: "AI 동아리",
  organizationType: "동아리",
  contactEmail: "ai-club@mju.ac.kr",
  purpose: "인공지능 스터디 및 프로젝트 진행",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// "서버에서 auth를 반드시 재검증한다" -- requireActiveUser()가 redirect
// (never return)하는 경우 서비스 함수까지 절대 도달하지 않는다.
describe("createOrganizationCreationRequestAction", () => {
  it("calls requireActiveUser() before doing anything else", async () => {
    requireActiveUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(createOrganizationCreationRequestAction(validInput)).rejects.toThrow();

    expect(createOrganizationCreationRequest).not.toHaveBeenCalled();
  });

  it("rejects an empty organizationName before calling the service", async () => {
    requireActiveUser.mockResolvedValueOnce(user);

    const result = await createOrganizationCreationRequestAction({ ...validInput, organizationName: "  " });

    expect(result).toEqual({ error: expect.any(String) });
    expect(createOrganizationCreationRequest).not.toHaveBeenCalled();
  });

  it("rejects an invalid email before calling the service", async () => {
    requireActiveUser.mockResolvedValueOnce(user);

    const result = await createOrganizationCreationRequestAction({ ...validInput, contactEmail: "not-an-email" });

    expect(result).toEqual({ error: expect.any(String) });
    expect(createOrganizationCreationRequest).not.toHaveBeenCalled();
  });

  it("surfaces a friendly error for a duplicate pending request, never a raw DB error", async () => {
    requireActiveUser.mockResolvedValueOnce(user);
    createOrganizationCreationRequest.mockResolvedValueOnce({ kind: "duplicate_pending_request" });

    const result = await createOrganizationCreationRequestAction(validInput);

    expect(result).toEqual({ error: expect.any(String) });
    if ("error" in result) {
      expect(result.error).not.toMatch(/prisma|constraint|P2002/i);
    }
  });

  it("creates the request via the service (which itself attaches the caller's own userId) and revalidates", async () => {
    requireActiveUser.mockResolvedValueOnce(user);
    createOrganizationCreationRequest.mockResolvedValueOnce({ kind: "ok", data: { id: 100 } });

    const result = await createOrganizationCreationRequestAction(validInput);

    expect(result).toEqual({ ok: true });
    expect(createOrganizationCreationRequest).toHaveBeenCalledWith(user, validInput);
    expect(revalidatePath).toHaveBeenCalledWith("/organizations/create");
  });
});

describe("cancelOrganizationCreationRequestAction", () => {
  it("calls requireActiveUser() before doing anything else", async () => {
    requireActiveUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(cancelOrganizationCreationRequestAction(100)).rejects.toThrow();

    expect(cancelOrganizationCreationRequest).not.toHaveBeenCalled();
  });

  it("passes the server-derived userId, never a client-supplied one, to the service", async () => {
    requireActiveUser.mockResolvedValueOnce(user);
    cancelOrganizationCreationRequest.mockResolvedValueOnce({ kind: "ok", data: { id: 100 } });

    await cancelOrganizationCreationRequestAction(100);

    expect(cancelOrganizationCreationRequest).toHaveBeenCalledWith(2, 100);
  });

  it("rejects cancelling another user's request", async () => {
    requireActiveUser.mockResolvedValueOnce(user);
    cancelOrganizationCreationRequest.mockResolvedValueOnce({ kind: "forbidden" });

    const result = await cancelOrganizationCreationRequestAction(999);

    expect(result).toEqual({ error: expect.any(String) });
  });

  it("rejects cancelling an already-processed request", async () => {
    requireActiveUser.mockResolvedValueOnce(user);
    cancelOrganizationCreationRequest.mockResolvedValueOnce({ kind: "invalid_state" });

    const result = await cancelOrganizationCreationRequestAction(100);

    expect(result).toEqual({ error: expect.any(String) });
  });

  it("succeeds and revalidates", async () => {
    requireActiveUser.mockResolvedValueOnce(user);
    cancelOrganizationCreationRequest.mockResolvedValueOnce({ kind: "ok", data: { id: 100 } });

    const result = await cancelOrganizationCreationRequestAction(100);

    expect(result).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/organizations/create");
  });
});
