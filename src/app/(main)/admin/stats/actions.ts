"use server";

import { z } from "zod";

import { requireAdmin } from "@/lib/auth/session";
import { addPeriods } from "@/lib/metrics/dashboard";
import { DATASETS, exportFileName, toCsv, toXlsx } from "@/lib/metrics/export";
import { kstDay } from "@/lib/metrics/record";
import { dashboardRange, daysBetween, loadReport, MAX_RANGE_DAYS, recentRange, type ReportRange } from "@/lib/metrics/report";

// 운영 통계 내보내기 (Excel / CSV). A Server Action rather than a download
// route: the Hobby plan's function cap is used up (see next.config.ts), and
// requireAdmin() here re-checks the caller against the DB on every call --
// a non-admin is redirected before anything is read. Only aggregate counts
// are read (the same loader as the dashboard, so the file matches the
// screen); nothing is written. The range is capped, and every query is a
// GROUP BY over it, so even the longest export is a few hundred rows.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)));
const inputSchema = z.object({
  format: z.enum(["xlsx", "csv"]),
  period: z.enum(["dashboard", "7", "30", "90", "custom"]),
  unit: z.enum(["day", "week", "month"]).default("day"),
  from: day.optional(),
  to: day.optional(),
  dataset: z.enum(DATASETS.map((d) => d.key) as [string, ...string[]]).default("summary"),
});
export type StatsExportInput = z.input<typeof inputSchema>;
export type StatsExportResult = { ok: true; filename: string; mime: string; base64: string } | { ok: false; error: string };

export async function exportStatsAction(input: StatsExportInput): Promise<StatsExportResult> {
  await requireAdmin();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "내보내기 조건을 확인해 주세요." };
  const { format, period, unit, from, to, dataset } = parsed.data;

  const today = kstDay();
  let range: ReportRange;
  if (period === "dashboard") range = dashboardRange(unit, today);
  else if (period === "custom") {
    if (!from || !to) return { ok: false, error: "시작일과 종료일을 모두 골라 주세요." };
    if (from > to) return { ok: false, error: "시작일이 종료일보다 늦습니다." };
    if (to > today) return { ok: false, error: "종료일은 오늘 이후로 고를 수 없습니다." };
    range = { from, until: addPeriods(to, "day", 1), unit: "day" };
    if (daysBetween(range.from, range.until) > 366) return { ok: false, error: "기간은 최대 366일까지 고를 수 있습니다." };
  } else range = recentRange(Number(period), today);
  if (daysBetween(range.from, range.until) > MAX_RANGE_DAYS) return { ok: false, error: "기간이 너무 깁니다." };

  try {
    const report = await loadReport(range);
    if (format === "xlsx") {
      return {
        ok: true,
        filename: exportFileName(report, "xlsx"),
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        base64: toXlsx(report).toString("base64"),
      };
    }
    const key = dataset as (typeof DATASETS)[number]["key"];
    return { ok: true, filename: exportFileName(report, "csv", key), mime: "text/csv;charset=utf-8", base64: Buffer.from(toCsv(report, key), "utf8").toString("base64") };
  } catch {
    return { ok: false, error: "파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
