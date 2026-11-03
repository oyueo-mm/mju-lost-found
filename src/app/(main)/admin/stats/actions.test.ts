import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const loadReport = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireAdmin, requirePermission: requireAdmin, requireAnyPermission: requireAdmin }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/metrics/record", () => ({ kstDay: () => "2026-10-16" }));
vi.mock("@/lib/metrics/report", async (importOriginal) => ({ ...(await importOriginal<object>()), loadReport }));
const loadUserReport = vi.fn(async (range: unknown) => ({ users: true, range }));
vi.mock("@/lib/metrics/userReport", async (importOriginal) => ({ ...(await importOriginal<object>()), loadUserReport }));
const loadHourlyCells = vi.fn(async (days: string[]) => ({ hourly: true, days }));
vi.mock("@/lib/metrics/hourly", async (importOriginal) => ({ ...(await importOriginal<object>()), loadHourlyCells }));
const loadDayVisits = vi.fn(async (day: string) => ({ dayVisits: true, day }));
const loadMultiDayVisits = vi.fn(async (days: string[]) => ({ dayVisits: true, figures: [], days }));
vi.mock("@/lib/metrics/dayVisits", async (importOriginal) => ({ ...(await importOriginal<object>()), loadDayVisits, loadMultiDayVisits }));
const loadInflow = vi.fn(async (days: string[]) => ({ inflow: true, days }));
vi.mock("@/lib/metrics/inflow", async (importOriginal) => ({ ...(await importOriginal<object>()), loadInflow }));
const toXlsx = vi.fn(() => Buffer.from("xlsx"));
const toCsv = vi.fn(() => "csv");
vi.mock("@/lib/metrics/export", async (importOriginal) => ({ ...(await importOriginal<object>()), toXlsx, toCsv }));

const { exportStatsAction } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ id: 1, isAdmin: true });
  loadReport.mockImplementation(async (range) => ({ range }));
});

describe("운영 통계 내보내기 action", () => {
  it("checks the admin before reading anything", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(exportStatsAction({ format: "xlsx", preset: "month" })).rejects.toThrow("NEXT_REDIRECT");
    expect(loadReport).not.toHaveBeenCalled();
  });

  it("exports the page's period: presets up to today, or a custom range", async () => {
    const xlsx = await exportStatsAction({ format: "xlsx", preset: "week" });
    expect(loadReport).toHaveBeenLastCalledWith({ from: "2026-10-10", until: "2026-10-17", unit: "day" });
    expect(xlsx).toMatchObject({ ok: true, filename: "mju-find-stats_20261010-20261016.xlsx", base64: Buffer.from("xlsx").toString("base64") });
    expect(toXlsx).toHaveBeenLastCalledWith(
      expect.anything(),
      "최근 7일 (2026-10-10 ~ 2026-10-16)",
      expect.objectContaining({ users: true }),
      expect.stringContaining("실제 이용자 통계가 아닙니다"),
      expect.objectContaining({ hourly: true }),
      expect.objectContaining({ dayVisits: true }),
      expect.objectContaining({ inflow: true }),
    );
    expect(loadUserReport).toHaveBeenLastCalledWith({ from: "2026-10-10", until: "2026-10-17", unit: "day" });
    // 날짜·시간대별 without chosen days: the page's default, the last 7 days
    expect(loadHourlyCells).toHaveBeenLastCalledWith(["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);

    await exportStatsAction({ format: "csv", preset: "year", dataset: "visits" });
    expect(loadReport).toHaveBeenLastCalledWith({ from: "2026-01-01", until: "2026-10-17", unit: "month" });
    expect(toCsv).toHaveBeenLastCalledWith(
      expect.anything(),
      "visits",
      "올해 (2026-01-01 ~ 2026-10-16)",
      expect.objectContaining({ users: true }),
      expect.stringContaining("실제 이용자 통계가 아닙니다"),
      expect.objectContaining({ hourly: true }),
      expect.objectContaining({ dayVisits: true }),
      expect.objectContaining({ inflow: true }),
    );

    const custom = await exportStatsAction({ format: "csv", preset: "custom", from: "2026-10-01", to: "2026-10-15", dataset: "server" });
    expect(loadReport).toHaveBeenLastCalledWith({ from: "2026-10-01", until: "2026-10-16", unit: "day" });
    expect(custom).toMatchObject({ ok: true, filename: "mju-find-stats-server_20261001-20261015.csv" });
  });

  it("exports the calendar's days for 날짜·시간대별 -- only those, named after them", async () => {
    const csv = await exportStatsAction({ format: "csv", preset: "month", dataset: "hourly", days: "2026-10-01,2026-10-03~2026-10-04,2026-10-20" });
    // a day after today is not a day that can be chosen
    expect(loadHourlyCells).toHaveBeenLastCalledWith(["2026-10-01", "2026-10-03", "2026-10-04"]);
    expect(csv).toMatchObject({ ok: true, filename: "mju-find-stats-hourly_20261001-20261004_3d.csv" });
    await exportStatsAction({ format: "xlsx", preset: "month", days: "" });
    expect(loadHourlyCells).toHaveBeenLastCalledWith([]);
  });

  it("exports 날짜별 방문 상세 for the page's day: `visitDay`, else the period's last day", async () => {
    await exportStatsAction({ format: "xlsx", preset: "week" });
    expect(loadDayVisits).toHaveBeenLastCalledWith("2026-10-16");
    await exportStatsAction({ format: "xlsx", preset: "custom", from: "2026-10-01", to: "2026-10-05" });
    expect(loadDayVisits).toHaveBeenLastCalledWith("2026-10-05");
    const csv = await exportStatsAction({ format: "csv", preset: "month", dataset: "dayVisits", visitDays: "2026-10-09" });
    expect(loadDayVisits).toHaveBeenLastCalledWith("2026-10-09");
    expect(csv).toMatchObject({ ok: true, filename: "mju-find-stats-day-visits_20261009.csv" });
    // several days, as encoded in the URL
    const many = await exportStatsAction({ format: "csv", preset: "month", dataset: "dayVisits", visitDays: "2026-10-01~2026-10-03,2026-10-05" });
    expect(loadMultiDayVisits).toHaveBeenLastCalledWith(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05"]);
    expect(many).toMatchObject({ ok: true, filename: "mju-find-stats-day-visits_20261001-20261005_4d.csv" });
    // 유입 경로 follows the same days
    expect(loadInflow).toHaveBeenLastCalledWith(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05"]);
    const inflowCsv = await exportStatsAction({ format: "csv", preset: "month", dataset: "inflow", visitDays: "2026-10-09" });
    expect(inflowCsv).toMatchObject({ ok: true, filename: "mju-find-stats-inflow_20261009.csv" });
    // only days that cannot be chosen: nothing to export for this sheet
    loadDayVisits.mockClear();
    loadMultiDayVisits.mockClear();
    await exportStatsAction({ format: "xlsx", preset: "month", visitDays: "2026-10-17,x" });
    expect(loadDayVisits).not.toHaveBeenCalled();
    expect(loadMultiDayVisits).not.toHaveBeenCalled();
  });

  it("rejects bad or oversized ranges without querying", async () => {
    for (const input of [
      { format: "xlsx", preset: "custom" },
      { format: "xlsx", preset: "custom", from: "2026-10-10", to: "2026-10-01" },
      { format: "xlsx", preset: "custom", from: "2026-10-01", to: "2026-10-20" },
      { format: "xlsx", preset: "custom", from: "2025-01-01", to: "2026-10-01" },
      { format: "pdf", preset: "today" },
      { format: "xlsx", preset: "decade" },
      { format: "csv", preset: "today", dataset: "members" },
      { format: "xlsx", preset: "custom", from: "2026-13-01", to: "2026-10-01" },
    ] as const) {
      const result = await exportStatsAction(input as never);
      expect(result.ok).toBe(false);
    }
    expect(loadReport).not.toHaveBeenCalled();
  });
});

describe("내보내기도 조회 권한을 따른다", () => {
  const as = (...keys: string[]) => requireAdmin.mockResolvedValue({ id: 7, isAdmin: false, adminPermissions: keys });
  it("운영 통계 권한만 있으면 사용자 통계 시트와 사용자 통계 CSV는 받을 수 없다", async () => {
    as("stats.operations");
    expect(await exportStatsAction({ format: "xlsx", preset: "month" })).toMatchObject({ ok: true });
    expect(loadUserReport).not.toHaveBeenCalled();
    expect((toXlsx.mock.calls.at(-1) as unknown[] | undefined)?.[2]).toBeUndefined();
    expect(await exportStatsAction({ format: "csv", preset: "month", dataset: "summary" })).toMatchObject({ ok: true });
    expect(await exportStatsAction({ format: "csv", preset: "month", dataset: "users" })).toEqual({ ok: false, error: "이 통계를 내보낼 권한이 없습니다." });
  });
  it("사용자 통계 권한만 있으면 사용자 통계 CSV만 받을 수 있다", async () => {
    as("stats.users");
    expect(await exportStatsAction({ format: "csv", preset: "month", dataset: "users" })).toMatchObject({ ok: true });
    expect(await exportStatsAction({ format: "csv", preset: "month", dataset: "summary" })).toMatchObject({ ok: false });
    expect(await exportStatsAction({ format: "xlsx", preset: "month" })).toMatchObject({ ok: false });
    expect(loadReport).toHaveBeenCalledTimes(1);
  });
  it("관리자 통계·홍보 권한만으로는 아무 통계도 내보낼 수 없고 아무것도 읽지 않는다", async () => {
    as("stats.admins", "promotion.manage");
    for (const dataset of ["summary", "users", "hourly"]) expect(await exportStatsAction({ format: "csv", preset: "month", dataset })).toMatchObject({ ok: false });
    expect(await exportStatsAction({ format: "xlsx", preset: "month" })).toMatchObject({ ok: false });
    expect(loadReport).not.toHaveBeenCalled(); expect(loadUserReport).not.toHaveBeenCalled();
  });
});
