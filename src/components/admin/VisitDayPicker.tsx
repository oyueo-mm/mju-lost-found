"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { addDays, EARLIEST_SELECTABLE_DAY } from "@/lib/metrics/daySelection";

// 날짜별 방문 분석의 날짜: one KST day, kept in the URL as `vd` next to the
// other /admin/stats parameters (조회 기간, 시간대 분석's days), which stay
// as they are. Previous / next day, a date field, and 오늘.
const field = "h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground";
const iconButton =
  "flex size-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

export function VisitDayPicker({ day, today }: { day: string; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const go = (next: string) => {
    if (!next || next > today || next < EARLIEST_SELECTABLE_DAY) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("vd", next);
    startTransition(() => router.replace(`${pathname}?${params.toString()}#day-visits`, { scroll: false }));
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
      <button type="button" className={iconButton} onClick={() => go(addDays(day, -1))} disabled={day <= EARLIEST_SELECTABLE_DAY} aria-label="이전 날짜">
        <ChevronLeftIcon className="size-4" />
      </button>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="sr-only">분석할 날짜</span>
        <input type="date" className={field} value={day} min={EARLIEST_SELECTABLE_DAY} max={today} onChange={(e) => go(e.target.value)} />
      </label>
      <button type="button" className={iconButton} onClick={() => go(addDays(day, 1))} disabled={day >= today} aria-label="다음 날짜">
        <ChevronRightIcon className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => go(today)}
        disabled={day === today}
        className="h-9 rounded-lg border border-border bg-background px-3 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        오늘
      </button>
    </div>
  );
}
