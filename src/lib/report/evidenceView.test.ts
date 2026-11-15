import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/generated/prisma/client";

const report = { findUnique: vi.fn() };
const adminAccessLog = { create: vi.fn() };
vi.mock("@/lib/db/prisma", () => ({ prisma: { report, adminAccessLog } }));
const signEvidenceUrl = vi.fn(async (path: string) => `https://signed/${path}`);
vi.mock("./evidenceStorage", async () => ({ ...await vi.importActual<typeof import("./evidenceStorage")>("./evidenceStorage"), signEvidenceUrl, copyToEvidence: vi.fn(), removeReportEvidence: vi.fn(), evidencePathFor: vi.fn() }));
vi.mock("@/lib/images/supabaseAdmin", () => ({ pathnameFromPublicUrl: () => null }));
const can = vi.fn(() => true);
vi.mock("@/lib/permissions/check", () => ({ can }));

const { getReportEvidenceImages } = await import("./evidenceView");
const admin = { id: 1, isAdmin: true } as unknown as User;

const messageSnapshot = {
  v: 1,
  subjectUserId: 6,
  target: { kind: "message", chatRoomId: 4, content: "x", senderNickname: null, createdAt: "2026-11-15T00:00:00.000Z", editedAt: null, hidden: false },
  images: [{ index: 0, source: "chat", status: "copied", path: "reports/9/0.jpg" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  can.mockReturnValue(true);
});

describe("getReportEvidenceImages (release C)", () => {
  it("refuses without reports.view, before reading anything", async () => {
    can.mockReturnValueOnce(false);
    expect(await getReportEvidenceImages(admin, 9)).toBeNull();
    expect(can).toHaveBeenCalledWith(admin, "reports.view");
    expect(report.findUnique).not.toHaveBeenCalled();
    expect(signEvidenceUrl).not.toHaveBeenCalled();
  });

  it("signs a chat evidence image only after logging the access", async () => {
    report.findUnique.mockResolvedValueOnce({ targetId: 3, targetSnapshot: messageSnapshot });
    const views = await getReportEvidenceImages(admin, 9);
    expect(adminAccessLog.create).toHaveBeenCalledWith({
      data: { adminUserId: 1, resource: "chat_image", chatRoomId: 4, messageId: 3, reportId: 9 },
    });
    expect(views).toEqual([{ index: 0, source: "chat", status: "copied", url: "https://signed/reports/9/0.jpg" }]);
  });

  it("hands out nothing when the access log can't be written", async () => {
    report.findUnique.mockResolvedValueOnce({ targetId: 3, targetSnapshot: messageSnapshot });
    adminAccessLog.create.mockRejectedValueOnce(new Error("db down"));
    await expect(getReportEvidenceImages(admin, 9)).rejects.toThrow();
    expect(signEvidenceUrl).not.toHaveBeenCalled();
  });

  it("never signs a different report's path or a mismatched image index", async () => {
    report.findUnique.mockResolvedValueOnce({ targetId: 3, targetSnapshot: {
      ...messageSnapshot, images: [
        { index: 0, source: "chat", status: "copied", path: "reports/10/0.jpg" },
        { index: 1, source: "chat", status: "copied", path: "reports/9/0.jpg" },
      ],
    } });
    expect((await getReportEvidenceImages(admin, 9))?.map((v) => v.url)).toEqual([null, null]);
    expect(signEvidenceUrl).not.toHaveBeenCalled();
    expect(adminAccessLog.create).not.toHaveBeenCalled();
  });

  it("does not log public post evidence, and signs nothing for failed copies", async () => {
    report.findUnique.mockResolvedValueOnce({
      targetId: 5,
      targetSnapshot: {
        ...messageSnapshot,
        target: { kind: "post" },
        images: [
          { index: 0, source: "post", status: "copied", path: "reports/9/0.jpg" },
          { index: 1, source: "post", status: "failed", path: null },
        ],
      },
    });
    const views = await getReportEvidenceImages(admin, 9);
    expect(adminAccessLog.create).not.toHaveBeenCalled();
    expect(signEvidenceUrl).toHaveBeenCalledTimes(1);
    expect(views?.map((v) => v.url)).toEqual(["https://signed/reports/9/0.jpg", null]);
  });

  it("an old report without a snapshot has no evidence images", async () => {
    report.findUnique.mockResolvedValueOnce({ targetId: 5, targetSnapshot: null });
    expect(await getReportEvidenceImages(admin, 9)).toEqual([]);
  });
});
