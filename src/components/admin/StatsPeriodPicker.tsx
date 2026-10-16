"use client";

import Link from "next/link";
import { useState } from "react";

import { ChevronRightIcon } from "@/components/icons";
import { PERIOD_PRESETS, type PeriodPreset } from "@/lib/metrics/exportOptions";

// 조회 기간 (/admin/stats): the four presets and 사용자 지정 on one row; the
// custom range form opens under the row (a plain GET form -- the page does
// the rest on the server).
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
const chip = (active: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs font-medium ${focusRing} ${
    active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"
  }`;
const field = "rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground";

export function StatsPeriodPicker({
  active,
  from,
  to,
  today,
  openByDefault,
  tab = "ops",
  keep,
}: {
  active: PeriodPreset;
  from: string;
  to: string;
  today: string;
  openByDefault: boolean;
  // keeps the 운영 / 사용자 통계 tab when the period changes
  tab?: "ops" | "users";
  // other params to keep (시간대 분석's days and metric), as a query string
  keep?: string;
}) {
  const tabQuery = `${tab === "ops" ? "" : `&tab=${tab}`}${keep ? `&${keep}` : ""}`;
  const [open, setOpen] = useState(openByDefault);
  return (
    <div className="flex flex-col gap-2">
      <nav className="flex flex-wrap gap-2" aria-label="조회 기간">
        {PERIOD_PRESETS.filter((p) => p.key !== "custom").map((p) => (
          <Link key={p.key} href={`/admin/stats?period=${p.key}${tabQuery}`} aria-current={active === p.key ? "page" : undefined} className={chip(active === p.key)}>
            {p.label}
          </Link>
        ))}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="stats-custom-period"
          onClick={() => setOpen((v) => !v)}
          className={`${chip(active === "custom")} inline-flex items-center gap-1`}
        >
          사용자 지정
          <ChevronRightIcon className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
      </nav>
      {open && (
        <form id="stats-custom-period" action="/admin/stats" className="flex flex-wrap items-end gap-2 text-xs text-muted-foreground">
          <input type="hidden" name="period" value="custom" />
          {tab !== "ops" && <input type="hidden" name="tab" value={tab} />}
          {[...new URLSearchParams(keep ?? "")].map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <label className="flex flex-col gap-1">
            시작일
            <input type="date" name="from" required max={today} defaultValue={from} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            종료일
            <input type="date" name="to" required max={today} defaultValue={to} className={field} />
          </label>
          <button type="submit" className={`rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground ${focusRing} focus-visible:ring-offset-2`}>
            조회
          </button>
          <span className="basis-full">최대 366일. 31일까지는 일별, 26주까지는 주별, 그보다 길면 월별로 묶어 보여 줍니다.</span>
        </form>
      )}
    </div>
  );
}
