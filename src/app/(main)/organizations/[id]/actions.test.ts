import { beforeEach, describe, expect, it, vi } from "vitest";

const requireActiveUser = vi.fn();
const createJoinRequest = vi.fn();
const cancelJoinRequest = vi.fn();
const leaveOrganization = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireActiveUser }));
vi.mock("@/lib/organization/service", () => ({ createJoinRequest, cancelJoinRequest, leaveOrganization }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { createOrganizationJoinRequestAction, cancelOrganizationJoinRequestAction, leaveOrganizationAction } =
  await import("./actions");

const user = { id: 2, isAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createOrganizationJoinRequestAction", () => {
  it("calls requireActiveUser() before doing anything else", async () => {
    requireActiveUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(createOrganizationJoinRequestAction(10, {})).rejects.toThrow();
    expect(createJoinRequest).not.toHaveBeenCalled();
  });

  // §26: 클라이언트가 userId를 넘길 방법이 애초에 없다 -- requireActiveUser()가
  // 반환한 세션의 user.id만 서비스 함수에 전달된다.
  it("서비스 함수에 세션의 user.id를 전달한다 (클라이언트 입력이 아님)", async () => {
    requireActiveUser.mockResolvedValueOnce(user);
    createJoinRequest.mockResolvedValueOnce({ kind: "ok", data: { id: 55 } });

    await createOrganizationJoinRequestAction(10, { message: "가입하고 싶습니다" });

    expect(createJoinRequest).toHaveBeenCalledWith(2, 10, { message: "가입하고 싶습니다" });
  });

  it("inactive_organization -> 친화적 오류", async () => {
    requireActiveUser.mockResolvedValueOnce(user);
    createJoinRequest.mockResolvedValueOnce({ kind: "inactive_organization" });
    const result = await createOrganizationJoinRequestAction(10, {});
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("duplicate_pending_request -> 친화적 오류", async () => {
    requireActiveUser.mockResolvedValueOnce(user);
    createJoinRequest.mockResolvedValueOnce({ kind: "duplicate_pending_request" });
    const result = await createOrganizationJoinRequestAction(10, {});
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("already_member -> 친화적 오류", async () => {
    requireActiveUser.mockResolvedValueOnce(user);
    createJoinRequest.mockResolvedValueOnce({ kind: "already_member" });
    const result = await createOrganizationJoinRequestAction(10, {});
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("성공 시 revalidatePath 호출", async () => {
    requireActiveUser.mockResolvedValueOnce(user);
    createJoinRequest.mockResolvedValueOnce({ kind: "ok", data: { id: 55 } });
    const result = await createOrganizationJoinRequestAction(10, {});
    expect(result).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/organizations/10");
  });
});

describe("cancelOrganizationJoinRequestAction", () => {
  it("calls requireActiveUser() before doing anything else", async () => {
    requireActiveUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(cancelOrganizationJoinRequestAction(10, 55)).rejects.toThrow();
    expect(cancelJoinRequest).not.toHaveBeenCalled();
  });

  it("타인의 신청이면 forbidden -> 친화적 오류", async () => {
    requireActiveUser.mockResolvedValueOnce(user);
    cancelJoinRequest.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await cancelOrganizationJoinRequestAction(10, 55);
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("정상 취소", async () => {
    requireActiveUser.mockResolvedValueOnce(user);
    cancelJoinRequest.mockResolvedValueOnce({ kind: "ok", data: { id: 55 } });
    const result = await cancelOrganizationJoinRequestAction(10, 55);
    expect(result).toEqual({ ok: true });
    expect(cancelJoinRequest).toHaveBeenCalledWith(2, 55);
  });
});

describe("leaveOrganizationAction", () => {
  it("calls requireActiveUser() before doing anything else", async () => {
    requireActiveUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(leaveOrganizationAction(10)).rejects.toThrow();
    expect(leaveOrganization).not.toHaveBeenCalled();
  });

  it("마지막 LEADER는 탈퇴 불가 -> 친화적 오류", async () => {
    requireActiveUser.mockResolvedValueOnce(user);
    leaveOrganization.mockResolvedValueOnce({ kind: "last_leader_cannot_leave" });
    const result = await leaveOrganizationAction(10);
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("본인 id로만 탈퇴를 시도한다 (targetUserId를 받지 않음)", async () => {
    requireActiveUser.mockResolvedValueOnce(user);
    leaveOrganization.mockResolvedValueOnce({ kind: "ok", data: { id: 2 } });

    const result = await leaveOrganizationAction(10);

    expect(result).toEqual({ ok: true });
    expect(leaveOrganization).toHaveBeenCalledWith(2, 10);
  });
});
