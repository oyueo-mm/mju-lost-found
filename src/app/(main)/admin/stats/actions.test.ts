import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const loadReport = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireAdmin }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/metrics/record", () => ({ kstDay: () => "2026-10-16" }));
vi.mock("@/lib/metrics/report", async (importOriginal) => ({ ...(await importOriginal<object>()), loadReport }));
const toXlsx = vi.fn(() => Buffer.from("xlsx"));
const toCsv = vi.fn(() => "csv");
vi.mock("@/lib/metrics/export", async (importOriginal) => ({ ...(await importOriginal<object>()), toXlsx, toCsv }));

const { exportStatsAction } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(loadReport).toHaveBeenLastCalledWith({ from: "2026-10-12", until: "2026-10-17", unit: "day" });
    expect(xlsx).toMatchObject({ ok: true, filename: "mju-find-stats_20261012-20261016.xlsx", base64: Buffer.from("xlsx").toString("base64") });
    expect(toXlsx).toHaveBeenLastCalledWith(expect.anything(), "이번 주 (2026-10-12 ~ 2026-10-16)");

    await exportStatsAction({ format: "csv", preset: "year", dataset: "visits" });
    expect(loadReport).toHaveBeenLastCalledWith({ from: "2026-01-01", until: "2026-10-17", unit: "month" });
    expect(toCsv).toHaveBeenLastCalledWith(expect.anything(), "visits", "올해 (2026-01-01 ~ 2026-10-16)");

    const custom = await exportStatsAction({ format: "csv", preset: "custom", from: "2026-10-01", to: "2026-10-15", dataset: "server" });
    expect(loadReport).toHaveBeenLastCalledWith({ from: "2026-10-01", until: "2026-10-16", unit: "day" });
    expect(custom).toMatchObject({ ok: true, filename: "mju-find-stats-server_20261001-20261015.csv" });
  });

  it("rejects bad or oversized ranges without querying", async () => {
    for (const input of [
      { format: "xlsx", preset: "custom" },
      { format: "xlsx", preset: "custom", from: "2026-10-10", to: "2026-10-01" },
      { format: "xlsx", preset: "custom", from: "2026-10-01", to: "2026-10-20" },
      { format: "xlsx", preset: "custom", from: "2025-01-01", to: "2026-10-01" },
      { format: "pdf", preset: "today" },
      { format: "xlsx", preset: "decade" },
      { format: "csv", preset: "today", dataset: "users" },
      { format: "xlsx", preset: "custom", from: "2026-13-01", to: "2026-10-01" },
    ] as const) {
      const result = await exportStatsAction(input as never);
      expect(result.ok).toBe(false);
    }
    expect(loadReport).not.toHaveBeenCalled();
  });
});
