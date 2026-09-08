import { beforeEach, describe, expect, it, vi } from "vitest";

const announcement = { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() };
const txAnnouncementCreate = vi.fn();
const txUserFindMany = vi.fn();
const txNotificationCreateMany = vi.fn();
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({
    announcement: { create: txAnnouncementCreate },
    user: { findMany: txUserFindMany },
    notification: { createMany: txNotificationCreateMany },
  }),
);

vi.mock("@/lib/db/prisma", () => ({ prisma: { announcement, $transaction } }));
vi.mock("@/lib/moderation/service", () => ({ isAdmin: (u: { isAdmin: boolean }) => u.isAdmin }));
vi.mock("@/generated/prisma/client", () => ({ NotificationType: { ANNOUNCEMENT: "ANNOUNCEMENT" } }));

const {
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  listAnnouncementsForAdmin,
  getAnnouncement,
} = await import("./service");

const admin = { id: 1, isAdmin: true };
const nonAdmin = { id: 2, isAdmin: false };

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 10,
  title: "정기 점검 안내",
  content: "9월 20일 새벽 서비스 점검이 있습니다.",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  createdBy: { nickname: "관리자닉네임" },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAnnouncement", () => {
  it("rejects a non-admin caller", async () => {
    const result = await createAnnouncement(nonAdmin as never, { title: "t", content: "c" });
    expect(result).toEqual({ kind: "forbidden" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("creates the announcement and fans out one Notification per existing user", async () => {
    txAnnouncementCreate.mockResolvedValueOnce(row());
    txUserFindMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }]);

    const result = await createAnnouncement(admin as never, { title: "정기 점검 안내", content: "9월 20일 새벽 서비스 점검이 있습니다." });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.id).toBe(10);

    expect(txAnnouncementCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { title: "정기 점검 안내", content: "9월 20일 새벽 서비스 점검이 있습니다.", createdByUserId: 1 },
      }),
    );
    expect(txNotificationCreateMany).toHaveBeenCalledWith({
      data: [
        { userId: 1, type: "ANNOUNCEMENT", title: row().title, content: row().content, relatedType: "announcement", relatedId: 10 },
        { userId: 2, type: "ANNOUNCEMENT", title: row().title, content: row().content, relatedType: "announcement", relatedId: 10 },
        { userId: 3, type: "ANNOUNCEMENT", title: row().title, content: row().content, relatedType: "announcement", relatedId: 10 },
      ],
      skipDuplicates: true,
    });
  });

  it("skips the notification fan-out entirely when there are no users yet", async () => {
    txAnnouncementCreate.mockResolvedValueOnce(row());
    txUserFindMany.mockResolvedValueOnce([]);

    await createAnnouncement(admin as never, { title: "t", content: "c" });

    expect(txNotificationCreateMany).not.toHaveBeenCalled();
  });
});

describe("updateAnnouncement", () => {
  it("rejects a non-admin caller", async () => {
    const result = await updateAnnouncement(nonAdmin as never, 10, { title: "t", content: "c" });
    expect(result).toEqual({ kind: "forbidden" });
    expect(announcement.update).not.toHaveBeenCalled();
  });

  it("returns not_found for a nonexistent announcement", async () => {
    announcement.findUnique.mockResolvedValueOnce(null);
    const result = await updateAnnouncement(admin as never, 999, { title: "t", content: "c" });
    expect(result).toEqual({ kind: "not_found" });
    expect(announcement.update).not.toHaveBeenCalled();
  });

  it("updates the announcement's own row only -- no notification side effect", async () => {
    announcement.findUnique.mockResolvedValueOnce(row());
    announcement.update.mockResolvedValueOnce(row({ title: "수정된 제목" }));

    const result = await updateAnnouncement(admin as never, 10, { title: "수정된 제목", content: row().content });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.title).toBe("수정된 제목");
    expect(announcement.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 10 }, data: { title: "수정된 제목", content: row().content } }),
    );
  });
});

describe("deleteAnnouncement", () => {
  it("rejects a non-admin caller", async () => {
    const result = await deleteAnnouncement(nonAdmin as never, 10);
    expect(result).toEqual({ kind: "forbidden" });
    expect(announcement.delete).not.toHaveBeenCalled();
  });

  it("returns not_found for a nonexistent announcement", async () => {
    announcement.findUnique.mockResolvedValueOnce(null);
    const result = await deleteAnnouncement(admin as never, 999);
    expect(result).toEqual({ kind: "not_found" });
  });

  it("deletes the announcement row (never touches already-sent notifications)", async () => {
    announcement.findUnique.mockResolvedValueOnce(row());
    const result = await deleteAnnouncement(admin as never, 10);
    expect(result).toEqual({ kind: "ok", data: { id: 10 } });
    expect(announcement.delete).toHaveBeenCalledWith({ where: { id: 10 } });
  });
});

describe("listAnnouncementsForAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const result = await listAnnouncementsForAdmin(nonAdmin as never, { page: 1, limit: 20 });
    expect(result).toEqual({ kind: "forbidden" });
    expect(announcement.findMany).not.toHaveBeenCalled();
  });

  it("lists announcements with pagination", async () => {
    announcement.findMany.mockResolvedValueOnce([row()]);
    announcement.count.mockResolvedValueOnce(1);

    const result = await listAnnouncementsForAdmin(admin as never, { page: 1, limit: 20 });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].createdByNickname).toBe("관리자닉네임");
      expect(result.data.total).toBe(1);
    }
  });
});

describe("getAnnouncement", () => {
  it("returns null for a non-integer id, without querying the DB", async () => {
    const result = await getAnnouncement(NaN);
    expect(result).toBeNull();
    expect(announcement.findUnique).not.toHaveBeenCalled();
  });

  it("returns null for a deleted/nonexistent announcement", async () => {
    announcement.findUnique.mockResolvedValueOnce(null);
    const result = await getAnnouncement(999);
    expect(result).toBeNull();
  });

  it("is a public read -- no admin argument, no isAdmin check", async () => {
    announcement.findUnique.mockResolvedValueOnce(row());
    const result = await getAnnouncement(10);
    expect(result?.id).toBe(10);
  });

  it("returns null createdByNickname when the author's account no longer exists", async () => {
    announcement.findUnique.mockResolvedValueOnce(row({ createdBy: null }));
    const result = await getAnnouncement(10);
    expect(result?.createdByNickname).toBeNull();
  });
});
