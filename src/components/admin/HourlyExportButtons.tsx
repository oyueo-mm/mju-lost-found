"use client";

import { useState, useTransition } from "react";

import { exportStatsAction } from "@/app/(main)/admin/stats/actions";
import { saveExport } from "@/components/admin/saveExport";
import type { PeriodPreset } from "@/lib/metrics/exportOptions";

// 시간대 분석의 내려받기: the same days as the calendar (`days`, encoded as
// in the URL) -- the 날짜·시간대별 CSV on its own, or the whole Excel file
// (its 날짜·시간대별 sheet holds these days; the other sheets the period).
export function HourlyExportButtons({ preset, from, to, days }: { preset: PeriodPreset; from?: string; to?: string; days: string }) {
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (format: "csv" | "xlsx") => {
    setMessage(null);
    startTransition(async () => {
      try {
        setMessage(saveExport(await exportStatsAction({ format, preset, from, to, dataset: "hourly", days })));
      } catch {
        setMessage({ kind: "error", text: "파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요." });
      }
    });
  };
  const button =
    "rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>고른 날짜 내려받기:</span>
      <button type="button" className={button} disabled={pending || !days} onClick={() => run("csv")}>
        CSV (날짜·시간대별)
      </button>
      <button type="button" className={button} disabled={pending || !days} onClick={() => run("xlsx")}>
        Excel (전체 시트)
      </button>
      {pending && <span>만드는 중…</span>}
      {message && (
        <span role="status" className={message.kind === "error" ? "text-destructive" : "text-success"}>
          {message.text}
        </span>
      )}
    </div>
  );
}
