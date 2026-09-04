import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/generated/prisma/client";

class FakePrismaClientKnownRequestError extends Error {
  code: string;
  constructor(code: string) {
    super("mock prisma error");
    this.code = code;
  }
}

const report = { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() };
const lostPost = { findUnique: vi.fn() };
const foundPost = { findUnique: vi.fn() };
const message = { findUnique: vi.fn() };
const userTable = { findUnique: vi.fn() };

vi.mock("@/lib/db/prisma", () => ({
  prisma: { report, lostPost, foundPost, message, user: userTable },
}));
vi.mock("@/generated/prisma/client", () => ({
  ReportTargetType: { POST: "POST", MESSAGE: "MESSAGE", USER: "USER" },
  ReportStatus: { PENDING: "PENDING", DISMISSED: "DISMISSED", ACTIONED: "ACTIONED" },
  Prisma: { PrismaClientKnownRequestError: FakePrismaClientKnownRequestError },
}));

const { createReport, getReportForUser, listReportsForUser } = await import("./service");

const reporter = { id: 1, nickname: "신고자" } as unknown as User;

function reportRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    reporterUserId: reporter.id,
    targetType: "POST",
    targetId: 5,
    reason: "기타",
    detail: null,
    status: "PENDING",
    createdAt: new Date("2026-01-01"),
    processedAt: null,
    adminNote: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createReport", () => {
  it("rejects reporting a nonexistent LostPost", async () => {
    lostPost.findUnique.mockResolvedValueOnce(null);

    const result = await createReport(reporter, { targetType: "post", targetId: 5, reason: "기타" });

    expect(result).toEqual({ kind: "target_not_found" });
    expect(report.create).not.toHaveBeenCalled();
  });

  it("resolves a negative post targetId against FoundPost", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 3, userId: 999 });
    report.create.mockResolvedValueOnce(reportRow({ targetId: -3 }));

    await createReport(reporter, { targetType: "post", targetId: -3, reason: "기타" });

    expect(foundPost.findUnique).toHaveBeenCalledWith({ where: { id: 3 }, select: { id: true, userId: true } });
    expect(lostPost.findUnique).not.toHaveBeenCalled();
  });

  it("rejects self-reporting your own LostPost", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 5, userId: reporter.id });

    const result = await createReport(reporter, { targetType: "post", targetId: 5, reason: "기타" });

    expect(result).toEqual({ kind: "self_report" });
    expect(report.create).not.toHaveBeenCalled();
  });

  it("rejects reporting a nonexistent message", async () => {
    message.findUnique.mockResolvedValueOnce(null);

    const result = await createReport(reporter, { targetType: "message", targetId: 42, reason: "욕설/비방" });

    expect(result).toEqual({ kind: "target_not_found" });
  });

  it("rejects self-reporting your own message", async () => {
    message.findUnique.mockResolvedValueOnce({ id: 42, senderUserId: reporter.id });

    const result = await createReport(reporter, { targetType: "message", targetId: 42, reason: "욕설/비방" });

    expect(result).toEqual({ kind: "self_report" });
  });

  it("rejects reporting a nonexistent user", async () => {
    userTable.findUnique.mockResolvedValueOnce(null);

    const result = await createReport(reporter, { targetType: "user", targetId: 999, reason: "기타" });

    expect(result).toEqual({ kind: "target_not_found" });
  });

  it("rejects reporting yourself", async () => {
    userTable.findUnique.mockResolvedValueOnce({ id: reporter.id });

    const result = await createReport(reporter, { targetType: "user", targetId: reporter.id, reason: "기타" });

    expect(result).toEqual({ kind: "self_report" });
  });

  it("creates a report for a valid, non-self target", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 5, userId: 999 });
    report.create.mockResolvedValueOnce(reportRow());

    const result = await createReport(reporter, { targetType: "post", targetId: 5, reason: "기타", detail: "상세" });

    expect(result.kind).toBe("ok");
    expect(report.create).toHaveBeenCalledWith({
      data: { reporterUserId: reporter.id, targetType: "POST", targetId: 5, reason: "기타", detail: "상세" },
    });
  });

  it("relies on the UNIQUE constraint (P2002) for duplicate reports, not a precheck", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 5, userId: 999 });
    report.create.mockRejectedValueOnce(new FakePrismaClientKnownRequestError("P2002"));

    const result = await createReport(reporter, { targetType: "post", targetId: 5, reason: "기타" });

    expect(result).toEqual({ kind: "duplicate" });
  });

  it("rethrows a non-P2002 error from the INSERT", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 5, userId: 999 });
    report.create.mockRejectedValueOnce(new Error("db down"));

    await expect(
      createReport(reporter, { targetType: "post", targetId: 5, reason: "기타" }),
    ).rejects.toThrow("db down");
  });
});

describe("getReportForUser", () => {
  it("returns not_found for a nonexistent report", async () => {
    report.findUnique.mockResolvedValueOnce(null);

    const result = await getReportForUser(999, reporter.id);

    expect(result).toEqual({ kind: "not_found" });
  });

  it("rejects a user who isn't the reporter (A's report id known by B)", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ reporterUserId: reporter.id }));

    const result = await getReportForUser(1, 999);

    expect(result).toEqual({ kind: "forbidden" });
  });

  it("returns the report for its own reporter", async () => {
    report.findUnique.mockResolvedValueOnce(reportRow({ reporterUserId: reporter.id }));

    const result = await getReportForUser(1, reporter.id);

    expect(result.kind).toBe("ok");
  });
});

describe("listReportsForUser", () => {
  it("scopes the query to the given reporterUserId", async () => {
    report.findMany.mockResolvedValueOnce([reportRow()]);

    const result = await listReportsForUser(reporter.id);

    expect(report.findMany).toHaveBeenCalledWith({
      where: { reporterUserId: reporter.id },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toHaveLength(1);
  });
});
