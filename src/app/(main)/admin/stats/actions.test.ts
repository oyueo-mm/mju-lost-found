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
    await expect(exportStatsAction({ format: "xlsx", period: "30" })).rejects.toThrow("NEXT_REDIRECT");
    expect(loadReport).not.toHaveBeenCalled();
  });

  it("exports the dashboard's range, recent days, or a custom range", async () => {
    const xlsx = await exportStatsAction({ format: "xlsx", period: "dashboard", unit: "week" });
    expect(loadReport).toHaveBeenLastCalledWith({ from: "2026-07-27", until: "2026-10-19", unit: "week" });
    expect(xlsx).toMatchObject({ ok: true, filename: "mju-find-stats_20260727-20261018.xlsx", base64: Buffer.from("xlsx").toString("base64") });

    await exportStatsAction({ format: "csv", period: "90", dataset: "visits" });
    expect(loadReport).toHaveBeenLastCalledWith({ from: "2026-07-19", until: "2026-10-17", unit: "day" });
    expect(toCsv).toHaveBeenLastCalledWith(expect.anything(), "visits");

    const custom = await exportStatsAction({ format: "csv", period: "custom", from: "2026-10-01", to: "2026-10-15", dataset: "server" });
    expect(loadReport).toHaveBeenLastCalledWith({ from: "2026-10-01", until: "2026-10-16", unit: "day" });
    expect(custom).toMatchObject({ ok: true, filename: "mju-find-stats-server_20261001-20261015.csv" });
  });

  it("rejects bad or oversized ranges without querying", async () => {
    for (const input of [
      { format: "xlsx", period: "custom" },
      { format: "xlsx", period: "custom", from: "2026-10-10", to: "2026-10-01" },
      { format: "xlsx", period: "custom", from: "2026-10-01", to: "2026-10-20" },
      { format: "xlsx", period: "custom", from: "2025-01-01", to: "2026-10-01" },
      { format: "pdf", period: "7" },
      { format: "csv", period: "7", dataset: "users" },
      { format: "xlsx", period: "custom", from: "2026-13-01", to: "2026-10-01" },
    ] as const) {
      const result = await exportStatsAction(input as never);
      expect(result.ok).toBe(false);
    }
    expect(loadReport).not.toHaveBeenCalled();
  });
});
