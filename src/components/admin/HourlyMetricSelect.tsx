"use client";

import { Select } from "@/components/ui/Select";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

// 시간대 분석 지표: one dropdown (six metrics and 전체 지표 보기). A choice
// replaces `m` in the URL and keeps the days and the period; the charts and
// the summary follow from the server without moving the page.
export function HourlyMetricSelect({ value, options }: { value: string; options: { value: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const change = (m: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("m", m);
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  };
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <span className="shrink-0 font-medium">지표</span>
      <span className="relative min-w-0">
        <Select
          value={value}
          onChange={(e) => change(e.target.value)}
          aria-busy={pending}
          className="h-9 w-full min-w-0 appearance-none rounded-lg border border-border bg-background py-1.5 pr-8 pl-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </span>
      {pending && <span className="shrink-0 text-primary">갱신 중…</span>}
    </label>
  );
}
