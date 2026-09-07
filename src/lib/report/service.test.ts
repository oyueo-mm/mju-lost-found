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
const comment = { findUnique: vi.fn() };
// Phase D-2: report/service.ts's message branch now derives room
// membership via chat/service.ts's own single-funnel participant
// helper -- mocked wholesale (not via importActual): its own import
// chain (Prisma client, images/supabaseAdmin, etc.) has nothing to do
// with what this file tests, same convention as this file's other
// wholesale mocks below.
const getChatRoomParticipantIds = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: { report, lostPost, foundPost, message, user: userTable, comment },
}));
vi.mock("@/lib/chat/service", () => ({ getChatRoomParticipantIds }));
vi.mock("@/generated/prisma/client", () => ({
  ReportTargetType: { POST: "POST", MESSAGE: "MESSAGE", USER: "USER", COMMENT: "COMMENT" },
  ReportStatus: { PENDING: "PENDING", DISMISSED: "DISMISSED", ACTIONED: "ACTIONED" },
  Prisma: { PrismaClientKnownRequestError: FakePrismaClientKnownRequestError },
}));

const { createReport, getReportForUser, getReportTargetRef, listReportsForUser } = await import("./service");

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
    expect(getChatRoomParticipantIds).not.toHaveBeenCalled();
  });

  it("creates a report for a message in a room the reporter actually participates in", async () => {
    message.findUnique.mockResolvedValueOnce({ id: 42, senderUserId: 999, chatRoomId: 7 });
    getChatRoomParticipantIds.mockResolvedValueOnce(new Set([reporter.id, 999]));
    report.create.mockResolvedValueOnce(reportRow({ targetType: "MESSAGE", targetId: 42 }));

    const result = await createReport(reporter, { targetType: "message", targetId: 42, reason: "욕설/비방" });

    expect(result.kind).toBe("ok");
    expect(getChatRoomParticipantIds).toHaveBeenCalledWith(7);
    expect(report.create).toHaveBeenCalledWith({
      data: { reporterUserId: reporter.id, targetType: "MESSAGE", targetId: 42, reason: "욕설/비방", detail: null },
    });
  });

  // Phase D-2: the core security fix -- a logged-in user who isn't a
  // participant of the message's own room must be rejected, even though
  // they'd pass every other check (message exists, isn't their own).
  it("rejects reporting a message in a room the reporter doesn't participate in (403, not_participant)", async () => {
    message.findUnique.mockResolvedValueOnce({ id: 42, senderUserId: 999, chatRoomId: 7 });
    getChatRoomParticipantIds.mockResolvedValueOnce(new Set([999, 1000])); // reporter.id (1) not in here

    const result = await createReport(reporter, { targetType: "message", targetId: 42, reason: "욕설/비방" });

    expect(result).toEqual({ kind: "not_participant" });
    expect(report.create).not.toHaveBeenCalled();
  });

  // Same outcome as above, phrased as this phase's own attack scenario:
  // the message really belongs to a room the reporter has nothing to do
  // with (never a room the reporter merely *claims*, since this API never
  // accepts a client-supplied chatRoomId to begin with -- targetId alone
  // is enough, and the real room is always read fresh from the message
  // row itself).
  it("rejects reporting a message that belongs to a different room entirely (never trusts any assumed room)", async () => {
    message.findUnique.mockResolvedValueOnce({ id: 99, senderUserId: 999, chatRoomId: 55 });
    getChatRoomParticipantIds.mockResolvedValueOnce(null); // room 55 not found / reporter has no relation to it

    const result = await createReport(reporter, { targetType: "message", targetId: 99, reason: "기타" });

    expect(result).toEqual({ kind: "not_participant" });
    expect(report.create).not.toHaveBeenCalled();
  });

  it("rejects self-reporting your own message, only after confirming room participation", async () => {
    message.findUnique.mockResolvedValueOnce({ id: 42, senderUserId: reporter.id, chatRoomId: 7 });
    getChatRoomParticipantIds.mockResolvedValueOnce(new Set([reporter.id, 999]));

    const result = await createReport(reporter, { targetType: "message", targetId: 42, reason: "욕설/비방" });

    expect(result).toEqual({ kind: "self_report" });
    expect(report.create).not.toHaveBeenCalled();
  });

  it("relies on the same UNIQUE constraint (P2002) for a duplicate message report", async () => {
    message.findUnique.mockResolvedValueOnce({ id: 42, senderUserId: 999, chatRoomId: 7 });
    getChatRoomParticipantIds.mockResolvedValueOnce(new Set([reporter.id, 999]));
    report.create.mockRejectedValueOnce(new FakePrismaClientKnownRequestError("P2002"));

    const result = await createReport(reporter, { targetType: "message", targetId: 42, reason: "기타" });

    expect(result).toEqual({ kind: "duplicate" });
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

  it("rejects reporting a nonexistent comment", async () => {
    comment.findUnique.mockResolvedValueOnce(null);

    const result = await createReport(reporter, { targetType: "comment", targetId: 42, reason: "욕설/비방" });

    expect(result).toEqual({ kind: "target_not_found" });
    expect(report.create).not.toHaveBeenCalled();
  });

  it("rejects self-reporting your own comment", async () => {
    comment.findUnique.mockResolvedValueOnce({ id: 42, authorUserId: reporter.id });

    const result = await createReport(reporter, { targetType: "comment", targetId: 42, reason: "욕설/비방" });

    expect(result).toEqual({ kind: "self_report" });
    expect(report.create).not.toHaveBeenCalled();
  });

  it("creates a report for someone else's comment", async () => {
    comment.findUnique.mockResolvedValueOnce({ id: 42, authorUserId: 999 });
    report.create.mockResolvedValueOnce(reportRow({ targetType: "COMMENT", targetId: 42 }));

    const result = await createReport(reporter, { targetType: "comment", targetId: 42, reason: "욕설/비방" });

    expect(result.kind).toBe("ok");
    expect(comment.findUnique).toHaveBeenCalledWith({
      where: { id: 42 },
      select: { id: true, authorUserId: true },
    });
    expect(report.create).toHaveBeenCalledWith({
      data: { reporterUserId: reporter.id, targetType: "COMMENT", targetId: 42, reason: "욕설/비방", detail: null },
    });
  });

  it("creates a reply's report the same way as a top-level comment's (a reply is just another Comment row)", async () => {
    comment.findUnique.mockResolvedValueOnce({ id: 43, authorUserId: 999 });
    report.create.mockResolvedValueOnce(reportRow({ targetType: "COMMENT", targetId: 43 }));

    const result = await createReport(reporter, { targetType: "comment", targetId: 43, reason: "기타" });

    expect(result.kind).toBe("ok");
  });

  it("relies on the same UNIQUE constraint (P2002) for a duplicate comment report", async () => {
    comment.findUnique.mockResolvedValueOnce({ id: 42, authorUserId: 999 });
    report.create.mockRejectedValueOnce(new FakePrismaClientKnownRequestError("P2002"));

    const result = await createReport(reporter, { targetType: "comment", targetId: 42, reason: "기타" });

    expect(result).toEqual({ kind: "duplicate" });
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

// Phase E-4
describe("getReportTargetRef", () => {
  it("returns null for a nonexistent report", async () => {
    report.findUnique.mockResolvedValueOnce(null);
    expect(await getReportTargetRef(999)).toBeNull();
  });

  it("resolves a post-target report, translating the DB enum", async () => {
    report.findUnique.mockResolvedValueOnce({ targetType: "POST", targetId: 5 });

    const ref = await getReportTargetRef(10);

    expect(ref).toEqual({ targetType: "post", targetId: 5 });
  });

  it("selects only targetType/targetId -- never reporterUserId/reason/detail/adminNote", async () => {
    report.findUnique.mockResolvedValueOnce({ targetType: "USER", targetId: 3 });

    await getReportTargetRef(10);

    expect(report.findUnique).toHaveBeenCalledWith({
      where: { id: 10 },
      select: { targetType: true, targetId: true },
    });
  });
});
