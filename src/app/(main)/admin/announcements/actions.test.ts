import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const createAnnouncement = vi.fn();
const updateAnnouncement = vi.fn();
const deleteAnnouncement = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireAdmin }));
vi.mock("@/lib/announcement/service", () => ({ createAnnouncement, updateAnnouncement, deleteAnnouncement }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { createAnnouncementAction, updateAnnouncementAction, deleteAnnouncementAction } = await import("./actions");

const admin = { id: 1, isAdmin: true };

beforeEach(() => {
  vi.clearAllMocks();
});

// Phase M section 4: "서버에서 관리자 권한을 반드시 재검증한다" -- every
// action below must call requireAdmin() itself, not merely trust that the
// page it was invoked from already gated on it. requireAdmin() redirects
// (never returns a typed result) for a non-admin/logged-out caller, so
// these actions never even reach their own input validation in that case
// -- verified here by having requireAdmin() reject and asserting the
// downstream service function was never called.
describe("createAnnouncementAction", () => {
  it("calls requireAdmin() before doing anything else", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(createAnnouncementAction({ title: "t", content: "c" })).rejects.toThrow();

    expect(createAnnouncement).not.toHaveBeenCalled();
  });

  it("rejects an empty title before calling the service", async () => {
    requireAdmin.mockResolvedValueOnce(admin);

    const result = await createAnnouncementAction({ title: "  ", content: "내용" });

    expect(result).toEqual({ error: expect.any(String) });
    expect(createAnnouncement).not.toHaveBeenCalled();
  });

  it("creates the announcement and revalidates the admin list", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    createAnnouncement.mockResolvedValueOnce({ kind: "ok", data: { id: 10 } });

    const result = await createAnnouncementAction({ title: "정기 점검 안내", content: "내용입니다" });

    expect(result).toEqual({ ok: true });
    expect(createAnnouncement).toHaveBeenCalledWith(admin, { title: "정기 점검 안내", content: "내용입니다" });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/announcements");
  });
});

describe("updateAnnouncementAction", () => {
  it("calls requireAdmin() before doing anything else", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(updateAnnouncementAction(10, { title: "t", content: "c" })).rejects.toThrow();

    expect(updateAnnouncement).not.toHaveBeenCalled();
  });

  it("returns an error for a nonexistent announcement", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    updateAnnouncement.mockResolvedValueOnce({ kind: "not_found" });

    const result = await updateAnnouncementAction(999, { title: "t", content: "c" });

    expect(result).toEqual({ error: expect.any(String) });
  });

  it("updates and revalidates both the admin list and the public detail page", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    updateAnnouncement.mockResolvedValueOnce({ kind: "ok", data: { id: 10 } });

    const result = await updateAnnouncementAction(10, { title: "수정된 제목", content: "내용" });

    expect(result).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/announcements");
    expect(revalidatePath).toHaveBeenCalledWith("/announcements/10");
  });
});

describe("deleteAnnouncementAction", () => {
  it("calls requireAdmin() before doing anything else", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(deleteAnnouncementAction(10)).rejects.toThrow();

    expect(deleteAnnouncement).not.toHaveBeenCalled();
  });

  it("deletes and revalidates the admin list", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    deleteAnnouncement.mockResolvedValueOnce({ kind: "ok", data: { id: 10 } });

    const result = await deleteAnnouncementAction(10);

    expect(result).toEqual({ ok: true });
    expect(deleteAnnouncement).toHaveBeenCalledWith(admin, 10);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/announcements");
  });
});
