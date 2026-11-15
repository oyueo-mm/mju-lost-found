import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/generated/prisma/client";

const report = { findUnique: vi.fn(), update: vi.fn() };
const query = vi.fn();
const transaction = vi.fn(async (fn) => fn({ report, $queryRaw: query }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $transaction: transaction } }));
const can = vi.fn(() => true);
vi.mock("@/lib/permissions/check", () => ({ can }));
const copyToEvidence = vi.fn(async () => true);
vi.mock("./evidenceStorage", async () => ({ ...await vi.importActual<typeof import("./evidenceStorage")>("./evidenceStorage"), copyToEvidence }));
vi.mock("@/lib/images/supabaseAdmin", () => ({ pathnameFromPublicUrl: () => null }));
const { retryReportEvidence } = await import("./evidenceRetry");
const admin = { id: 1 } as User;
const source = "chat/4/11111111-1111-1111-1111-111111111111.jpg";
const row = () => ({ status: "PENDING", snapshotPurgedAt: null, targetSnapshot: {
  v: 1, subjectUserId: 2, target: { kind: "message", chatRoomId: 4 },
  images: [{ index: 0, source: "chat", status: "failed", path: null, retryPath: source }],
} });
beforeEach(() => { vi.clearAllMocks(); can.mockReturnValue(true); });
describe("retryReportEvidence", () => {
  it("denies unprivileged callers before touching the DB", async () => {
    can.mockReturnValueOnce(false);
    expect(await retryReportEvidence(admin, 9)).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("serializes retries and copies only the original captured source", async () => {
    report.findUnique.mockResolvedValueOnce(row());
    expect(await retryReportEvidence(admin, 9)).toBe(true);
    expect(query).toHaveBeenCalled();
    expect(copyToEvidence).toHaveBeenCalledWith("chat-images", source, "reports/9/0.jpg");
    expect(report.update.mock.calls[0][0].data.targetSnapshot.images[0]).toEqual({ index: 0, source: "chat", status: "copied", path: "reports/9/0.jpg" });
  });
  it("never revives processed or purged evidence", async () => {
    report.findUnique.mockResolvedValueOnce({ ...row(), status: "ACTIONED" });
    expect(await retryReportEvidence(admin, 9)).toBe(false);
    report.findUnique.mockResolvedValueOnce({ ...row(), snapshotPurgedAt: new Date() });
    expect(await retryReportEvidence(admin, 9)).toBe(false);
    expect(copyToEvidence).not.toHaveBeenCalled();
    expect(report.update).not.toHaveBeenCalled();
  });
  it("does not copy another room or fabricate a source for old failed snapshots", async () => {
    const wrong = row();
    wrong.targetSnapshot.images[0].retryPath = source.replace("chat/4/", "chat/5/");
    report.findUnique.mockResolvedValueOnce(wrong);
    await retryReportEvidence(admin, 9);
    const old = row();
    delete (old.targetSnapshot.images[0] as { retryPath?: string }).retryPath;
    report.findUnique.mockResolvedValueOnce(old);
    await retryReportEvidence(admin, 9);
    expect(copyToEvidence).not.toHaveBeenCalled();
  });
  it("keeps the original retry information when Storage fails", async () => {
    report.findUnique.mockResolvedValueOnce(row());
    copyToEvidence.mockResolvedValueOnce(false);
    await retryReportEvidence(admin, 9);
    expect(report.update.mock.calls[0][0].data.targetSnapshot.images[0]).toMatchObject({ status: "failed", retryPath: source });
  });
});
