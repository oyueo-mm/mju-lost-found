import type { ReactNode } from "react";

import { Sparkline } from "@/components/admin/StatsCharts";
import { ChevronRightIcon } from "@/components/icons";

// Layout pieces shared by both tabs of /admin/stats (운영 통계, 사용자 통계)
// so their cards, sections and notes look the same.

export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 rounded-card border border-border bg-card p-4 md:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description && <div className="text-xs leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      {children}
    </section>
  );
}

// A sub-heading inside a section, with an optional basis line.
export function SubHeading({ children, basis }: { children: ReactNode; basis?: ReactNode }) {
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      <span className="text-xs font-semibold text-foreground">{children}</span>
      {basis && <> · {basis}</>}
    </p>
  );
}

export function More({ label = "자세히 보기", children }: { label?: string; children: ReactNode }) {
  return (
    <details className="group text-[11px] leading-relaxed text-muted-foreground">
      <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-1 rounded-md font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        {label}
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

// 미측정 / 집계 대기 in a card's value slot: quieter than a number, never 0.
export const Unmeasured = ({ text = "미측정" }: { text?: string }) => (
  <span className="inline-flex items-center rounded-md border border-dashed border-border px-1.5 py-0.5 text-sm font-semibold text-muted-foreground">{text}</span>
);

// One figure. `primary` cards lead a page (핵심 지표: larger value, accent
// rule); the rest sit inside a section. `trend` adds the period sparkline,
// pinned to the bottom so cards in a row line up.
export function StatTile({
  label,
  value,
  sub,
  trend,
  primary = false,
  className = "",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  trend?: (number | null)[];
  primary?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-card border p-3 ${primary ? "border-border bg-card shadow-xs" : "border-border/80 bg-muted/30"} ${className}`}
    >
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className={`font-bold text-foreground ${primary ? "text-2xl" : "text-xl"}`}>{value}</span>
      {sub && <span className="text-[11px] leading-snug text-muted-foreground">{sub}</span>}
      {trend && <Sparkline values={trend} />}
    </div>
  );
}
