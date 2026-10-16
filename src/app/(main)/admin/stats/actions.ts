"use server";

import { z } from "zod";

import { requireAdmin } from "@/lib/auth/session";
import { DATASETS, exportFileName, toCsv, toXlsx } from "@/lib/metrics/export";
import { PERIOD_PRESETS } from "@/lib/metrics/exportOptions";
import { kstDay } from "@/lib/metrics/record";
import { loadReport, resolvePeriod } from "@/lib/metrics/report";
import { loadUserReport } from "@/lib/metrics/userReport";

// 운영 통계 내보내기 (Excel / CSV). A Server Action rather than a download
// route: the Hobby plan's function cap is used up (see next.config.ts), and
// requireAdmin() here re-checks the caller against the DB on every call --
// a non-admin is redirected before anything is read. The period is the one
// chosen on the page, resolved by the same resolvePeriod() + loadReport()
// the page uses, so the file shows the screen's numbers. Only aggregate
// counts are read; nothing is written. Custom ranges are capped (366 days)
// and every query is a GROUP BY over the range, so even the longest export
// is a few hundred rows.

const inputSchema = z.object({
  format: z.enum(["xlsx", "csv"]),
  preset: z.enum(PERIOD_PRESETS.map((p) => p.key) as [string, ...string[]]),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  dataset: z.enum(DATASETS.map((d) => d.key) as [string, ...string[]]).default("summary"),
});
export type StatsExportInput = z.input<typeof inputSchema>;
export type StatsExportResult = { ok: true; filename: string; mime: string; base64: string } | { ok: false; error: string };

export async function exportStatsAction(input: StatsExportInput): Promise<StatsExportResult> {
  await requireAdmin();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "내보내기 조건을 확인해 주세요." };
  const { format, preset, from, to, dataset } = parsed.data;

  const period = resolvePeriod({ preset: preset as (typeof PERIOD_PRESETS)[number]["key"], from, to }, kstDay());
  if ("error" in period) return { ok: false, error: period.error };

  try {
    const [report, users] = await Promise.all([loadReport(period.range), loadUserReport(period.range)]);
    if (format === "xlsx") {
      return {
        ok: true,
        filename: exportFileName(report, "xlsx"),
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        base64: toXlsx(report, period.label, users).toString("base64"),
      };
    }
    const key = dataset as (typeof DATASETS)[number]["key"];
    return {
      ok: true,
      filename: exportFileName(report, "csv", key),
      mime: "text/csv;charset=utf-8",
      base64: Buffer.from(toCsv(report, key, period.label, users), "utf8").toString("base64"),
    };
  } catch {
    return { ok: false, error: "파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
