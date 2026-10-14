import { beforeEach, describe, expect, it, vi } from "vitest";

// A server action can be posted to by anyone: a non-admin must be stopped
// before anything is read or logged.
const requireAdmin = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireAdmin }));
const viewIdentityForReport = vi.fn();
vi.mock("@/lib/identity/service", () => ({ viewIdentityForReport }));

const { viewReportPartyIdentityAction } = await import("./identityActions");

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("viewReportPartyIdentityAction", () => {
  it("stops a non-admin at requireAdmin (redirect) without reading anything", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("REDIRECT:/"));
    await expect(viewReportPartyIdentityAction(null, form({ reportId: "1", targetUserId: "2", reason: "확인 사유입니다" }))).rejects.toThrow(
      "REDIRECT:/",
    );
    expect(viewIdentityForReport).not.toHaveBeenCalled();
  });

  it("passes the admin, report, target and reason through, and maps refusals to messages", async () => {
    const admin = { id: 9, isAdmin: true };
    requireAdmin.mockResolvedValue(admin);
    viewIdentityForReport.mockResolvedValueOnce({
      kind: "ok",
      data: { nickname: "n", realName: "홍길동", department: "학생지원팀", updatedAt: new Date("2026-10-14T00:00:00Z") },
    });
    const ok = await viewReportPartyIdentityAction(null, form({ reportId: "5", targetUserId: "2", reason: "반환 분쟁 확인" }));
    expect(viewIdentityForReport).toHaveBeenCalledWith(admin, { reportId: 5, targetUserId: 2, reason: "반환 분쟁 확인" });
    expect(ok).toMatchObject({ ok: true, realName: "홍길동", updatedAt: "2026-10-14T00:00:00.000Z" });

    viewIdentityForReport.mockResolvedValueOnce({ kind: "forbidden" });
    expect(await viewReportPartyIdentityAction(null, form({ reportId: "5", targetUserId: "99", reason: "반환 분쟁 확인" }))).toMatchObject({ ok: false });

    expect(await viewReportPartyIdentityAction(null, form({ reportId: "x", targetUserId: "2", reason: "반환 분쟁 확인" }))).toEqual({
      ok: false,
      error: "잘못된 요청입니다.",
    });
  });
});
