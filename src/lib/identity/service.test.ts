import { beforeEach, describe, expect, it, vi } from "vitest";

const userIdentityInfo = { findUnique: vi.fn(), count: vi.fn(), upsert: vi.fn() };
const report = { findUnique: vi.fn() };
const comment = { findUnique: vi.fn() };
const txUser = { findUnique: vi.fn() };
const identityAccessLog = { create: vi.fn() };
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ user: txUser, identityAccessLog }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { userIdentityInfo, report, comment, $transaction } }));

const resolvePostTarget = vi.fn();
const resolveMessageTarget = vi.fn();
const resolveUserTarget = vi.fn();
vi.mock("@/lib/report/targets", () => ({ resolvePostTarget, resolveMessageTarget, resolveUserTarget }));

const { getOwnIdentityInfo, hasIdentityInfo, reportPartyUserIds, saveOwnIdentityInfo, viewIdentityForReport } = await import(
  "./service"
);
const { CURRENT_IDENTITY_CONSENT_VERSION } = await import("@/lib/auth/terms");

const admin = { id: 9, isAdmin: true };
const REASON = "습득물 반환 분쟁 확인";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("own 실명·학과", () => {
  it("reads only the member's own row, by their own id", async () => {
    userIdentityInfo.findUnique.mockResolvedValueOnce(null);
    expect(await getOwnIdentityInfo(5)).toBeNull();
    expect(userIdentityInfo.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 5 } }));
  });

  it("saving records the separate consent version and time with the values", async () => {
    const now = new Date("2026-10-14T00:00:00Z");
    await saveOwnIdentityInfo(5, { realName: "홍길동", department: "컴퓨터공학과" }, now);
    const data = { realName: "홍길동", department: "컴퓨터공학과", consentVersion: CURRENT_IDENTITY_CONSENT_VERSION, consentedAt: now };
    expect(userIdentityInfo.upsert).toHaveBeenCalledWith({ where: { userId: 5 }, create: { userId: 5, ...data }, update: data });
  });

  it("hasIdentityInfo is a plain existence check", async () => {
    userIdentityInfo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    expect(await hasIdentityInfo(5)).toBe(false);
    expect(await hasIdentityInfo(5)).toBe(true);
  });
});

describe("report parties", () => {
  it("are the reporter and the author of the reported content, for every target type", async () => {
    report.findUnique.mockResolvedValueOnce({ reporterUserId: 1, targetType: "POST", targetId: -7 });
    resolvePostTarget.mockResolvedValueOnce({ postKind: "found", id: 7, userId: 2 });
    expect(await reportPartyUserIds(10)).toEqual({ reporterUserId: 1, targetUserId: 2 });

    report.findUnique.mockResolvedValueOnce({ reporterUserId: 1, targetType: "MESSAGE", targetId: 3 });
    resolveMessageTarget.mockResolvedValueOnce({ id: 3, senderUserId: 4, chatRoomId: 1 });
    expect(await reportPartyUserIds(11)).toEqual({ reporterUserId: 1, targetUserId: 4 });

    // A deleted comment still counts -- the dispute can be about it.
    report.findUnique.mockResolvedValueOnce({ reporterUserId: 1, targetType: "COMMENT", targetId: 8 });
    comment.findUnique.mockResolvedValueOnce({ authorUserId: 6 });
    expect(await reportPartyUserIds(12)).toEqual({ reporterUserId: 1, targetUserId: 6 });

    report.findUnique.mockResolvedValueOnce({ reporterUserId: 1, targetType: "USER", targetId: 5 });
    resolveUserTarget.mockResolvedValueOnce({ id: 5 });
    expect(await reportPartyUserIds(13)).toEqual({ reporterUserId: 1, targetUserId: 5 });
  });
});

describe("admin view of 실명·학과", () => {
  const partiesOfReport = () => report.findUnique.mockResolvedValueOnce({ reporterUserId: 1, targetType: "USER", targetId: 2 });

  it("shows a party's details and logs who, whom, which report and why -- in one transaction", async () => {
    partiesOfReport();
    resolveUserTarget.mockResolvedValueOnce({ id: 2 });
    const updatedAt = new Date("2026-10-14T01:00:00Z");
    txUser.findUnique.mockResolvedValueOnce({ nickname: "습득자", identityInfo: { realName: "홍길동", department: "학생지원팀", updatedAt } });

    const result = await viewIdentityForReport(admin, { reportId: 10, targetUserId: 2, reason: `  ${REASON}  ` });

    expect(result).toEqual({ kind: "ok", data: { nickname: "습득자", realName: "홍길동", department: "학생지원팀", updatedAt } });
    expect(identityAccessLog.create).toHaveBeenCalledWith({
      data: { adminUserId: 9, targetUserId: 2, reportId: 10, reason: REASON },
    });
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it("refuses a non-admin before reading or logging anything", async () => {
    const result = await viewIdentityForReport({ id: 3, isAdmin: false }, { reportId: 10, targetUserId: 2, reason: REASON });
    expect(result).toEqual({ kind: "forbidden" });
    expect(report.findUnique).not.toHaveBeenCalled();
    expect(identityAccessLog.create).not.toHaveBeenCalled();
  });

  it("refuses anyone who is not a party of that report", async () => {
    partiesOfReport();
    resolveUserTarget.mockResolvedValueOnce({ id: 2 });
    expect(await viewIdentityForReport(admin, { reportId: 10, targetUserId: 99, reason: REASON })).toEqual({ kind: "forbidden" });
    expect(txUser.findUnique).not.toHaveBeenCalled();
    expect(identityAccessLog.create).not.toHaveBeenCalled();
  });

  it("requires a reason of at least 5 characters", async () => {
    for (const reason of [undefined, "", "   ", "확인"]) {
      expect(await viewIdentityForReport(admin, { reportId: 10, targetUserId: 2, reason })).toEqual({ kind: "invalid_reason" });
    }
    expect(report.findUnique).not.toHaveBeenCalled();
    expect(identityAccessLog.create).not.toHaveBeenCalled();
  });

  it("logs the view even when the member never entered anything", async () => {
    partiesOfReport();
    resolveUserTarget.mockResolvedValueOnce({ id: 2 });
    txUser.findUnique.mockResolvedValueOnce({ nickname: "습득자", identityInfo: null });

    const result = await viewIdentityForReport(admin, { reportId: 10, targetUserId: 1, reason: REASON });

    expect(result).toEqual({ kind: "ok", data: { nickname: "습득자", realName: null, department: null, updatedAt: null } });
    expect(identityAccessLog.create).toHaveBeenCalledTimes(1);
  });
});
