import { beforeEach, describe, expect, it, vi } from "vitest";

const requireActiveUser = vi.fn();
const isAdmin = vi.fn();
const appointAdmin = vi.fn();
const removeAdmin = vi.fn();
const removeMember = vi.fn();
const transferLeadership = vi.fn();
const approveJoinRequest = vi.fn();
const rejectJoinRequest = vi.fn();
const deactivateOrganization = vi.fn();
const updateOrganizationProfile = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireActiveUser }));
vi.mock("@/lib/moderation/service", () => ({ isAdmin }));
vi.mock("@/lib/organization/service", () => ({
  appointAdmin,
  removeAdmin,
  removeMember,
  transferLeadership,
  approveJoinRequest,
  rejectJoinRequest,
  deactivateOrganization,
  updateOrganizationProfile,
}));
vi.mock("next/cache", () => ({ revalidatePath }));

const {
  updateOrganizationProfileAction,
  appointAdminAction,
  removeAdminAction,
  removeMemberAction,
  transferLeadershipAction,
  approveOrganizationJoinRequestAction,
  rejectOrganizationJoinRequestAction,
  deactivateOrganizationAction,
} = await import("./actions");

const leader = { id: 1, isAdmin: false };
const validProfileInput = { name: "새 이름", organizationType: "동아리" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateOrganizationProfileAction", () => {
  it("calls requireActiveUser() before doing anything else", async () => {
    requireActiveUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(updateOrganizationProfileAction(10, validProfileInput)).rejects.toThrow();
    expect(updateOrganizationProfile).not.toHaveBeenCalled();
  });

  it("빈 조직명은 서버에서 거절 (service 호출 전)", async () => {
    requireActiveUser.mockResolvedValueOnce(leader);
    const result = await updateOrganizationProfileAction(10, { name: "  ", organizationType: "동아리" });
    expect(result).toEqual({ error: expect.any(String) });
    expect(updateOrganizationProfile).not.toHaveBeenCalled();
  });

  it("forbidden -> 친화적 오류", async () => {
    requireActiveUser.mockResolvedValueOnce(leader);
    updateOrganizationProfile.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await updateOrganizationProfileAction(10, validProfileInput);
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("정상 수정 -- OrganizationStatus는 입력으로 받지 않는다", async () => {
    requireActiveUser.mockResolvedValueOnce(leader);
    updateOrganizationProfile.mockResolvedValueOnce({ kind: "ok", data: {} });
    const result = await updateOrganizationProfileAction(10, validProfileInput);
    expect(result).toEqual({ ok: true });
    expect(updateOrganizationProfile).toHaveBeenCalledWith(1, 10, expect.not.objectContaining({ status: expect.anything() }));
  });
});

describe("appointAdminAction / removeAdminAction / removeMemberAction", () => {
  it("appointAdminAction: calls requireActiveUser() first", async () => {
    requireActiveUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(appointAdminAction(10, 3)).rejects.toThrow();
    expect(appointAdmin).not.toHaveBeenCalled();
  });

  it("appointAdminAction: forbidden -> 친화적 오류", async () => {
    requireActiveUser.mockResolvedValueOnce(leader);
    appointAdmin.mockResolvedValueOnce({ kind: "forbidden" });
    expect(await appointAdminAction(10, 3)).toEqual({ error: expect.any(String) });
  });

  it("appointAdminAction: 정상 임명 -- actor id는 세션에서만", async () => {
    requireActiveUser.mockResolvedValueOnce(leader);
    appointAdmin.mockResolvedValueOnce({ kind: "ok", data: {} });
    const result = await appointAdminAction(10, 3);
    expect(result).toEqual({ ok: true });
    expect(appointAdmin).toHaveBeenCalledWith(1, 10, 3);
  });

  it("removeAdminAction: invalid_state -> 친화적 오류", async () => {
    requireActiveUser.mockResolvedValueOnce(leader);
    removeAdmin.mockResolvedValueOnce({ kind: "invalid_state" });
    expect(await removeAdminAction(10, 3)).toEqual({ error: expect.any(String) });
  });

  it("removeMemberAction: 정상 제거", async () => {
    requireActiveUser.mockResolvedValueOnce(leader);
    removeMember.mockResolvedValueOnce({ kind: "ok", data: { id: 3 } });
    const result = await removeMemberAction(10, 3);
    expect(result).toEqual({ ok: true });
    expect(removeMember).toHaveBeenCalledWith(1, 10, 3);
  });

  it("removeMemberAction: forbidden -> 친화적 오류 (예: ADMIN이 다른 ADMIN 제거 시도)", async () => {
    requireActiveUser.mockResolvedValueOnce(leader);
    removeMember.mockResolvedValueOnce({ kind: "forbidden" });
    expect(await removeMemberAction(10, 3)).toEqual({ error: expect.any(String) });
  });
});

describe("transferLeadershipAction", () => {
  it("calls requireActiveUser() before doing anything else", async () => {
    requireActiveUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(transferLeadershipAction(10, 3)).rejects.toThrow();
    expect(transferLeadership).not.toHaveBeenCalled();
  });

  it("forbidden (LEADER가 아님) -> 친화적 오류", async () => {
    requireActiveUser.mockResolvedValueOnce(leader);
    transferLeadership.mockResolvedValueOnce({ kind: "forbidden" });
    expect(await transferLeadershipAction(10, 3)).toEqual({ error: expect.any(String) });
  });

  it("정상 승계 -- 현재 LEADER는 세션에서만 결정", async () => {
    requireActiveUser.mockResolvedValueOnce(leader);
    transferLeadership.mockResolvedValueOnce({ kind: "ok", data: { id: 3 } });
    const result = await transferLeadershipAction(10, 3);
    expect(result).toEqual({ ok: true });
    expect(transferLeadership).toHaveBeenCalledWith(10, 1, 3);
  });
});

describe("approveOrganizationJoinRequestAction / rejectOrganizationJoinRequestAction", () => {
  it("approve: calls requireActiveUser() before doing anything else", async () => {
    requireActiveUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(approveOrganizationJoinRequestAction(10, 55)).rejects.toThrow();
    expect(approveJoinRequest).not.toHaveBeenCalled();
  });

  it("approve: invalid_state(이미 처리됨) -> 친화적 오류", async () => {
    requireActiveUser.mockResolvedValueOnce(leader);
    approveJoinRequest.mockResolvedValueOnce({ kind: "invalid_state" });
    expect(await approveOrganizationJoinRequestAction(10, 55)).toEqual({ error: expect.any(String) });
  });

  it("approve: 정상 승인", async () => {
    requireActiveUser.mockResolvedValueOnce(leader);
    approveJoinRequest.mockResolvedValueOnce({ kind: "ok", data: { id: 55 } });
    const result = await approveOrganizationJoinRequestAction(10, 55);
    expect(result).toEqual({ ok: true });
    expect(approveJoinRequest).toHaveBeenCalledWith(1, 55);
  });

  it("reject: calls requireActiveUser() before doing anything else", async () => {
    requireActiveUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(rejectOrganizationJoinRequestAction(10, 55, {})).rejects.toThrow();
    expect(rejectJoinRequest).not.toHaveBeenCalled();
  });

  it("reject: 정상 거절", async () => {
    requireActiveUser.mockResolvedValueOnce(leader);
    rejectJoinRequest.mockResolvedValueOnce({ kind: "ok", data: { id: 55 } });
    const result = await rejectOrganizationJoinRequestAction(10, 55, { rejectionReason: "정원 초과" });
    expect(result).toEqual({ ok: true });
    expect(rejectJoinRequest).toHaveBeenCalledWith(1, 55, { rejectionReason: "정원 초과" });
  });
});

describe("deactivateOrganizationAction", () => {
  it("calls requireActiveUser() before doing anything else", async () => {
    requireActiveUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(deactivateOrganizationAction(10)).rejects.toThrow();
    expect(deactivateOrganization).not.toHaveBeenCalled();
  });

  it("forbidden (ADMIN/MEMBER는 비활성화 불가) -> 친화적 오류", async () => {
    requireActiveUser.mockResolvedValueOnce(leader);
    isAdmin.mockReturnValueOnce(false);
    deactivateOrganization.mockResolvedValueOnce({ kind: "forbidden" });
    expect(await deactivateOrganizationAction(10)).toEqual({ error: expect.any(String) });
  });

  // §26/§22: isPlatformAdmin override는 세션 유저의 실제 isAdmin 값에서만
  // 나온다 -- 클라이언트가 "나는 admin이다"를 주장할 방법이 없다.
  it("세션 유저의 isAdmin 값을 그대로 override 파라미터로 전달한다", async () => {
    const platformAdmin = { id: 9, isAdmin: true };
    requireActiveUser.mockResolvedValueOnce(platformAdmin);
    isAdmin.mockReturnValueOnce(true);
    deactivateOrganization.mockResolvedValueOnce({ kind: "ok", data: { id: 10 } });

    const result = await deactivateOrganizationAction(10);

    expect(result).toEqual({ ok: true });
    expect(deactivateOrganization).toHaveBeenCalledWith(9, 10, true);
  });
});
