import { describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { adminActivityLog: { create } } }));

const { canViewAllAdminActivity, recordAdminActivity } = await import("./activityLog");

describe("canViewAllAdminActivity (관리자별 상세 기록 전체 보기)", () => {
  it("only an admin whose id is listed", () => {
    expect(canViewAllAdminActivity({ id: 13, isAdmin: true }, "13")).toBe(true);
    expect(canViewAllAdminActivity({ id: 13, isAdmin: true }, " 4, 13 ")).toBe(true);
    expect(canViewAllAdminActivity({ id: 20, isAdmin: true }, "4,13")).toBe(false);
    // listed but no longer an admin
    expect(canViewAllAdminActivity({ id: 13, isAdmin: false }, "13")).toBe(false);
  });

  it("nobody when unset, empty or malformed (fails closed)", () => {
    expect(canViewAllAdminActivity({ id: 13, isAdmin: true }, undefined)).toBe(false);
    expect(canViewAllAdminActivity({ id: 13, isAdmin: true }, "")).toBe(false);
    expect(canViewAllAdminActivity({ id: 13, isAdmin: true }, "13abc,1e1,*")).toBe(false);
  });
});

describe("recordAdminActivity", () => {
  it("writes the key and the target id only", async () => {
    await recordAdminActivity(13, "announcement.delete", { type: "announcement", id: 4 });
    expect(create).toHaveBeenCalledWith({ data: { adminUserId: 13, action: "announcement.delete", targetType: "announcement", targetId: 4 } });
  });

  it("never fails the task it follows", async () => {
    create.mockRejectedValueOnce(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordAdminActivity(13, "settings.update")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("Admin activity not recorded:", "Error");
    error.mockRestore();
  });
});
