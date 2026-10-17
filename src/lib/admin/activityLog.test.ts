import { describe, expect, it, vi } from "vitest";

const create = vi.fn();
const $executeRaw = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { adminActivityLog: { create }, $executeRaw } }));

const { canViewAllAdminActivity, recordAdminActivity, ADMIN_ACTIVITY_FAILED_METRIC } = await import("./activityLog");

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

  it("retries once; a passing retry is just a record", async () => {
    create.mockClear();
    $executeRaw.mockClear();
    create.mockRejectedValueOnce(new Error("blip"));
    await expect(recordAdminActivity(13, "settings.update")).resolves.toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
    expect($executeRaw).not.toHaveBeenCalled();
  });

  it("never fails the task it follows, and never drops silently: error log + failure count", async () => {
    create.mockClear();
    create.mockRejectedValue(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordAdminActivity(13, "user.unsuspend", { type: "user", id: 5 })).resolves.toBe(false);
    expect(create).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      "[admin-activity] record failed",
      JSON.stringify({ adminUserId: 13, action: "user.unsuspend", targetType: "user", targetId: 5, error: "Error" }),
    );
    const sql = ($executeRaw.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(sql).toContain('INSERT INTO "MetricDaily"');
    expect($executeRaw.mock.calls[0][2]).toBe(ADMIN_ACTIVITY_FAILED_METRIC);
    // even the count failing stays inside: the task's response is unaffected
    $executeRaw.mockRejectedValueOnce(new Error("db down"));
    await expect(recordAdminActivity(13, "settings.update")).resolves.toBe(false);
    expect(error).toHaveBeenCalledWith("[admin-activity] failure count not recorded", "Error");
    create.mockReset();
    error.mockRestore();
  });
});
