import { beforeEach, describe, expect, it, vi } from "vitest";

const userIdentityInfo = { findUnique: vi.fn(), count: vi.fn(), upsert: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() };
const user = { update: vi.fn() };
const report = { findUnique: vi.fn() };
const comment = { findUnique: vi.fn() };
const txUser = { findUnique: vi.fn(), update: vi.fn() };
const identityAccessLog = { create: vi.fn() };
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ user: txUser, identityAccessLog, userIdentityInfo }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { userIdentityInfo, user, report, comment, $transaction } }));

const resolvePostTarget = vi.fn();
const resolveMessageTarget = vi.fn();
const resolveUserTarget = vi.fn();
vi.mock("@/lib/report/targets", () => ({ resolvePostTarget, resolveMessageTarget, resolveUserTarget }));

const {
  getOwnIdentityInfo,
  hasIdentityInfo,
  reportPartyUserIds,
  saveOwnIdentityInfo,
  syncIdentityFromHints,
  viewIdentityForReport,
} = await import("./service");
const { ACCEPTED_IDENTITY_CONSENT_VERSIONS, CURRENT_IDENTITY_CONSENT_VERSION } = await import("@/lib/auth/terms");

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
    await saveOwnIdentityInfo(5, { realName: "홍길동", department: "컴퓨터공학과" }, { realName: "google_profile", department: "self" }, now);
    const data = {
      realName: "홍길동",
      department: "컴퓨터공학과",
      realNameSource: "google_profile",
      departmentSource: "self",
      consentVersion: CURRENT_IDENTITY_CONSENT_VERSION,
      consentedAt: now,
    };
    expect(userIdentityInfo.upsert).toHaveBeenCalledWith({ where: { userId: 5 }, create: { userId: 5, ...data }, update: data });
  });

  it("hasIdentityInfo needs values on file and the current 실명·소속 consent", async () => {
    userIdentityInfo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    expect(await hasIdentityInfo(5)).toBe(false);
    expect(await hasIdentityInfo(5)).toBe(true);
    expect(userIdentityInfo.count).toHaveBeenCalledWith({
      where: { userId: 5, user: { identityConsentVersion: { in: [...ACCEPTED_IDENTITY_CONSENT_VERSIONS] } } },
    });
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
    txUser.findUnique.mockResolvedValueOnce({
      nickname: "습득자",
      identityInfo: { realName: "홍길동", department: "학생지원팀", realNameSource: "google_profile", departmentSource: "self", updatedAt },
    });

    const result = await viewIdentityForReport(admin, { reportId: 10, targetUserId: 2, reason: `  ${REASON}  ` });

    expect(result).toEqual({
      kind: "ok",
      data: { nickname: "습득자", realName: "홍길동", department: "학생지원팀", realNameSource: "google_profile", departmentSource: "self", updatedAt },
    });
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

    expect(result).toEqual({
      kind: "ok",
      data: { nickname: "습득자", realName: null, department: null, realNameSource: null, departmentSource: null, updatedAt: null },
    });
    expect(identityAccessLog.create).toHaveBeenCalledTimes(1);
  });
});

// 이름·소속 자동 수집
describe("automatic collection", () => {
  const consented = { id: 5, identityConsentVersion: CURRENT_IDENTITY_CONSENT_VERSION };
  const fromDisplayName = { name: "홍길동", department: "컴퓨터공학과", nameSource: "google_display_name" as const, departmentSource: "google_display_name" as const };
  const now = new Date("2026-10-15T00:00:00Z");

  // No consent on the current version (never given, or the earlier optional
  // one) -> never collected, at sign-in or anywhere else.
  it("stores nothing without the current consent, or without a display-name split", async () => {
    expect(await syncIdentityFromHints({ id: 5, identityConsentVersion: null }, fromDisplayName)).toBe("skipped");
    expect(await syncIdentityFromHints({ id: 5, identityConsentVersion: "2026-10-01" }, fromDisplayName)).toBe("skipped");
    expect(await syncIdentityFromHints(consented, { name: "홍길동", department: null, nameSource: "google_profile" })).toBe("skipped");
    expect(await syncIdentityFromHints(consented, { name: null, department: null })).toBe("skipped");
    expect(await syncIdentityFromHints(consented, undefined)).toBe("skipped");
    expect(await syncIdentityFromHints(consented, { ...fromDisplayName, departmentSource: "google_people" })).toBe("skipped");
    expect(userIdentityInfo.findUnique).not.toHaveBeenCalled();
    expect(userIdentityInfo.create).not.toHaveBeenCalled();
  });

  // A consent on another accepted version (Preview's 2026-10-16) still
  // collects, and the member's own version is kept, never re-stamped.
  it("keeps the version the member consented to", async () => {
    userIdentityInfo.findUnique.mockResolvedValueOnce(null);
    expect(await syncIdentityFromHints({ id: 5, identityConsentVersion: "2026-10-16" }, fromDisplayName, now)).toBe("created");
    expect(userIdentityInfo.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 5, consentVersion: "2026-10-16" }) });
  });

  it("creates the values from the display name the first time", async () => {
    userIdentityInfo.findUnique.mockResolvedValueOnce(null);
    expect(await syncIdentityFromHints(consented, fromDisplayName, now)).toBe("created");
    expect(userIdentityInfo.create).toHaveBeenCalledWith({
      data: {
        userId: 5,
        realName: "홍길동",
        department: "컴퓨터공학과",
        realNameSource: "google_display_name",
        departmentSource: "google_display_name",
        consentVersion: CURRENT_IDENTITY_CONSENT_VERSION,
        consentedAt: now,
      },
    });
  });

  it("writes nothing when Google still says the same", async () => {
    userIdentityInfo.findUnique.mockResolvedValueOnce({ realName: "홍길동", department: "컴퓨터공학과", realNameSource: "google_display_name", departmentSource: "google_display_name" });
    expect(await syncIdentityFromHints(consented, fromDisplayName)).toBe("unchanged");
    expect(userIdentityInfo.update).not.toHaveBeenCalled();
  });

  it("updates when the Google name changed, and replaces values the member had to type", async () => {
    userIdentityInfo.findUnique.mockResolvedValueOnce({ realName: "홍길동", department: "경영학과", realNameSource: "google_display_name", departmentSource: "google_display_name" });
    expect(await syncIdentityFromHints(consented, fromDisplayName)).toBe("updated");
    userIdentityInfo.findUnique.mockResolvedValueOnce({ realName: "홍길동", department: "컴퓨터공학과", realNameSource: "self", departmentSource: "self" });
    expect(await syncIdentityFromHints(consented, fromDisplayName)).toBe("updated");
    expect(userIdentityInfo.update).toHaveBeenCalledTimes(2);
    expect(userIdentityInfo.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { userId: 5 }, data: expect.objectContaining({ realNameSource: "google_display_name" }) }),
    );
  });

});
