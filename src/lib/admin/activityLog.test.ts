import { describe, expect, it, vi } from "vitest";

const create = vi.fn();
const $executeRaw = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { adminActivityLog: { create }, $executeRaw } }));

const { canViewAllAdminActivity, recordAdminActivity, recordAdminVisit, ADMIN_ACTIVITY_FAILED_METRIC, ADMIN_VISIT_FAILED_METRIC, ADMIN_VISIT_GAP_MINUTES } = await import("./activityLog");
const { Prisma } = await import("@/generated/prisma/client");

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

describe("recordAdminVisit (관리자 활동 > 방문)", () => {
  it("one statement: extend the latest visit active within 30 minutes, else open a new one, in UTC", async () => {
    $executeRaw.mockReset();
    await recordAdminVisit(13, new Date("2026-10-17T03:00:00Z"));
    expect(ADMIN_VISIT_GAP_MINUTES).toBe(30);
    expect($executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = $executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const q = Prisma.sql(strings, ...values);
    expect(q.sql).toContain('"last_active_at" > ');
    expect(q.sql).toContain("make_interval(mins => ");
    expect(q.sql).toContain('UPDATE "AdminVisit"');
    expect(q.sql).toContain('INSERT INTO "AdminVisit"');
    expect(q.sql).toContain("WHERE NOT EXISTS (SELECT 1 FROM extended)");
    expect(q.sql).toContain("::timestamptz AT TIME ZONE 'UTC'");
    expect(q.values).toContain("2026-10-17T03:00:00.000Z");
    expect(q.values).toContain(30);
    expect(q.values.filter((v) => v === 13)).toHaveLength(2);
  });

  it("a failed write is logged and counted, never thrown", async () => {
    $executeRaw.mockReset();
    $executeRaw.mockRejectedValueOnce(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordAdminVisit(13)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("[admin-activity] visit failed", JSON.stringify({ adminUserId: 13, error: "Error" }));
    expect($executeRaw.mock.calls[1][2]).toBe(ADMIN_VISIT_FAILED_METRIC);
    error.mockRestore();
  });

  it("an admin's sign-in is recorded as auth.sign_in; its failure counts as a visit/sign-in failure", async () => {
    create.mockReset();
    $executeRaw.mockReset();
    create.mockRejectedValue(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordAdminActivity(13, "auth.sign_in");
    expect(create.mock.calls[0][0].data.action).toBe("auth.sign_in");
    expect($executeRaw.mock.calls[0][2]).toBe(ADMIN_VISIT_FAILED_METRIC);
    create.mockReset();
    error.mockRestore();
  });
});
