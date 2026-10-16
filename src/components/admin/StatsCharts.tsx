import type { ReactNode } from "react";

import type { Coverage } from "@/lib/metrics/report";
import { formatTick, formatValue, labelEvery, niceRange, niceScale, type Scale } from "@/components/admin/chartScale";

// 운영 통계 charts, drawn on the server in HTML/CSS (no chart library, no
// client JS). Every chart shares one frame: a y-axis with clean ticks and
// hairline gridlines (chartScale.ts), x labels thinned to fit, a legend for
// two or more series, and a hover / tap card per period. A period before
// a count began (미측정) is a hatched band, never a bar; a period counted
// only in part (부분 측정) is a hatched bar; a measured 0 is a short grey
// tick on the baseline -- so the three never look alike. Each chart also
// carries a screen-reader table of its values.

const fmt = (n: number) => n.toLocaleString("ko-KR");

// Fixed series hues (globals.css --chart-*), assigned by meaning across the
// dashboard: 1 회원·로그인·주 지표, 2 비로그인·대비 지표, 3 신규·세 번째, 4 기타.
// 5-8 only extend identity sets past three (시간대 분석: one line per day,
// DAY_TONES below).
export type ChartTone = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const TONE: Record<ChartTone, { bg: string; fill: string; stroke: string; border: string }> = {
  1: { bg: "bg-chart-1", fill: "fill-chart-1", stroke: "stroke-chart-1", border: "border-chart-1" },
  2: { bg: "bg-chart-2", fill: "fill-chart-2", stroke: "stroke-chart-2", border: "border-chart-2" },
  3: { bg: "bg-chart-3", fill: "fill-chart-3", stroke: "stroke-chart-3", border: "border-chart-3" },
  4: { bg: "bg-chart-4", fill: "fill-chart-4", stroke: "stroke-chart-4", border: "border-chart-4" },
  5: { bg: "bg-chart-5", fill: "fill-chart-5", stroke: "stroke-chart-5", border: "border-chart-5" },
  6: { bg: "bg-chart-6", fill: "fill-chart-6", stroke: "stroke-chart-6", border: "border-chart-6" },
  7: { bg: "bg-chart-7", fill: "fill-chart-7", stroke: "stroke-chart-7", border: "border-chart-7" },
  8: { bg: "bg-chart-8", fill: "fill-chart-8", stroke: "stroke-chart-8", border: "border-chart-8" },
};
// Seven identity hues in their validated order (no neutral grey): the n-th
// chosen day is always DAY_TONES[n], so a day keeps its colour in every chart.
export const DAY_TONES: readonly ChartTone[] = [1, 2, 3, 5, 6, 7, 8];

// `status` (optional, per value): when one series is measured differently
// from the others at the same point (시간대 분석: one line per day) --
// 부분 측정 values get a hollow dot on a line, and hours not reached yet say
// so in the hover card instead of 미측정.
export type PointStatus = Coverage | "future";
export type ChartSeries = { label: string; values: (number | null)[]; tone: ChartTone; status?: PointStatus[] };

const pointText = (x: number | null, status: PointStatus | undefined, unit: string) =>
  status === "future" ? "아직 지나지 않음" : x === null || status === "none" ? "미측정" : `${formatValue(x)}${unit}${status === "partial" ? " (부분 측정)" : ""}`;

type ChartProps = {
  title: string;
  labels: string[];
  series: ChartSeries[];
  // shown beside the title and after every value ("명", "회", "건")
  unit?: string;
  // per period; without it a period whose every value is null is 미측정
  coverage?: Coverage[];
  // the last period runs to today (its count is still growing)
  inProgress?: boolean;
  // x labels to show: every k-th (default: about 7 of them)
  tickEvery?: number;
  note?: ReactNode;
};

type Status = Coverage;

function statusOf(i: number, series: ChartSeries[], coverage?: Coverage[]): Status {
  if (series.every((s) => s.values[i] === null)) return "none";
  return coverage?.[i] ?? "full";
}

// runs of consecutive 미측정 periods: [first, last + 1)
function unmeasuredRuns(status: Status[]): [number, number][] {
  const runs: [number, number][] = [];
  status.forEach((s, i) => {
    if (s !== "none") return;
    const last = runs[runs.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else runs.push([i, i + 1]);
  });
  return runs;
}

const Swatch = ({ className }: { className: string }) => <span className={`inline-block size-2.5 shrink-0 rounded-[3px] ${className}`} aria-hidden />;

function Legend({ series, status, zero, unit }: { series: ChartSeries[]; status: Status[]; zero: boolean; unit: string }) {
  const items: ReactNode[] = [];
  if (series.length > 1)
    series.forEach((s) =>
      items.push(
        <span key={s.label} className="flex items-center gap-1">
          <Swatch className={TONE[s.tone].bg} />
          {s.label}
        </span>,
      ),
    );
  if (status.includes("partial"))
    items.push(
      <span key="partial" className="flex items-center gap-1">
        <Swatch className={`${TONE[series[0].tone].bg} chart-hatch-on opacity-60`} />
        부분 측정
      </span>,
    );
  if (status.includes("none"))
    items.push(
      <span key="none" className="flex items-center gap-1">
        <Swatch className="chart-hatch border border-border bg-muted" />
        미측정(수집 전)
      </span>,
    );
  if (zero)
    items.push(
      <span key="zero" className="flex items-center gap-1">
        <span className="inline-block h-[3px] w-2.5 rounded-full bg-muted-foreground/80" aria-hidden />
        {`0${unit}`}
      </span>,
    );
  return items.length ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">{items}</div> : null;
}

// The hover / tap card for one period: placed above the plot, kept inside
// the chart at both ends.
function Tooltip({ i, n, label, status, inProgress, rows, total, unit }: {
  i: number;
  n: number;
  label: string;
  status: Status;
  inProgress: boolean;
  rows: { label: string; value: number | null; tone: ChartTone; status?: PointStatus }[];
  total?: number | null;
  unit: string;
}) {
  const place = n < 3 ? "left-1/2 -translate-x-1/2" : i < n / 3 ? "left-0" : i >= (2 * n) / 3 ? "right-0" : "left-1/2 -translate-x-1/2";
  const v = (x: number | null) => (x === null ? "미측정" : `${formatValue(x)}${unit}`);
  return (
    <div
      role="presentation"
      className={`pointer-events-none absolute bottom-full z-20 mb-1 hidden min-w-28 flex-col gap-1 rounded-lg border border-border bg-card px-2.5 py-2 text-[11px] whitespace-nowrap text-foreground shadow-lg group-hover:flex group-focus:flex ${place}`}
    >
      <span className="font-semibold">
        {label}
        {status === "partial" && <span className="font-normal text-muted-foreground"> · 부분 측정</span>}
        {inProgress && <span className="font-normal text-muted-foreground"> · 진행 중</span>}
      </span>
      {status === "none" ? (
        <span className="text-muted-foreground">미측정(수집 전, 0건이 아님)</span>
      ) : (
        <>
          {rows.map((r) => (
            <span key={r.label} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {rows.length > 1 && <Swatch className={TONE[r.tone].bg} />}
                {r.label}
              </span>
              <span className="font-semibold tabular-nums">{r.status ? pointText(r.value, r.status, unit) : v(r.value)}</span>
            </span>
          ))}
          {total !== undefined && rows.length > 1 && (
            <span className="flex justify-between gap-3 border-t border-border pt-1">
              <span className="text-muted-foreground">합계</span>
              <span className="font-semibold tabular-nums">{v(total)}</span>
            </span>
          )}
        </>
      )}
    </div>
  );
}

// The shared frame: caption + legend, y ticks + gridlines, 미측정 bands, one
// hoverable column per period (`column(i)` draws its marks), x labels and a
// screen-reader table. `overlay` sits under the columns (the line chart).
function Frame({
  title,
  labels,
  series,
  unit = "",
  inProgress = false,
  tickEvery,
  note,
  scale,
  status,
  column,
  overlay,
  total,
  zero = false,
}: ChartProps & {
  scale: Scale;
  status: Status[];
  column: (i: number) => ReactNode;
  overlay?: ReactNode;
  total?: (i: number) => number | null;
  // a measured 0 is drawn (the legend then explains the baseline tick)
  zero?: boolean;
}) {
  const n = labels.length;
  const every = tickEvery ?? labelEvery(n);
  const runs = unmeasuredRuns(status);
  const pctOf = (v: number) => `${((v - scale.bottom) / (scale.top - scale.bottom)) * 100}%`;
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-foreground">
          {title}
          {unit && <span className="ml-1 font-normal text-muted-foreground">(단위: {unit})</span>}
        </span>
        <Legend series={series} status={status} zero={zero} unit={unit} />
        {scale.bottom > 0 && (
          <span className="text-[11px] text-muted-foreground">
            세로축은 <b className="font-semibold text-foreground">{`${formatTick(scale.bottom, scale.decimals)}${unit}`}</b>부터 (0부터 아님)
          </span>
        )}
      </figcaption>
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-1.5" aria-hidden>
        <div className="relative h-36">
          <div className="absolute inset-x-0 top-4 bottom-0">
            {scale.ticks.map((t) => (
              <span key={t} className="absolute right-0 translate-y-1/2 text-[10px] leading-none tabular-nums text-muted-foreground" style={{ bottom: pctOf(t) }}>
                {formatTick(t, scale.decimals)}
              </span>
            ))}
          </div>
        </div>
        <div className="relative h-36">
          {runs.map(([a, b]) => (
            <div
              key={a}
              className="chart-hatch absolute inset-y-0 flex items-center justify-center rounded-sm bg-muted/60"
              style={{ left: `${(a / n) * 100}%`, width: `${((b - a) / n) * 100}%` }}
            >
              {(b - a) / n >= 0.15 && <span className="rounded bg-card/80 px-1 text-[10px] text-muted-foreground">미측정</span>}
            </div>
          ))}
          <div className="absolute inset-x-0 top-4 bottom-0">
            {scale.ticks.map((t) => (
              <div key={t} className={`absolute inset-x-0 border-t ${t === scale.bottom ? "border-muted-foreground/40" : "border-border"}`} style={{ bottom: pctOf(t) }} />
            ))}
            {overlay}
            <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
              {labels.map((label, i) => (
                <div key={i} tabIndex={-1} className="group relative flex h-full items-end justify-center outline-none hover:bg-foreground/[0.04] focus:bg-foreground/[0.04]">
                  {column(i)}
                  <Tooltip
                    i={i}
                    n={n}
                    label={label}
                    status={status[i]}
                    inProgress={inProgress && i === n - 1}
                    rows={series.map((s) => ({ label: s.label, value: s.values[i], tone: s.tone, status: s.status?.[i] }))}
                    total={total?.(i)}
                    unit={unit}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div />
        <div className="grid pt-1 text-[10px] leading-none tabular-nums text-muted-foreground" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {labels.map((label, i) => (
            <span key={i} className="flex justify-center whitespace-nowrap">
              {i % every === 0 ? label : ""}
            </span>
          ))}
        </div>
      </div>
      {note && <div className="text-[11px] leading-relaxed text-muted-foreground">{note}</div>}
      {/* sr-only on the wrapper: a table ignores its 1px clip box */}
      <div className="sr-only">
        <table>
          <caption>{`${title}${unit ? ` (단위: ${unit})` : ""}${scale.bottom > 0 ? ` 세로축 ${formatTick(scale.bottom, scale.decimals)}부터` : ""}`}</caption>
          <thead>
            <tr>
              <th scope="col">구간</th>
              {series.map((s) => (
                <th key={s.label} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, i) => (
              <tr key={i}>
                <th scope="row">
                  {label}
                  {status[i] === "partial" ? " (부분 측정)" : ""}
                </th>
                {series.map((s) => (
                  <td key={s.label}>{s.status ? pointText(s.values[i], s.status[i], "") : s.values[i] === null ? "미측정" : formatValue(s.values[i]!)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

const isInteger = (series: ChartSeries[]) => series.every((s) => s.values.every((v) => v === null || Number.isInteger(v)));

// Which periods get a number on their cap (index -> extra class): every
// one up to 7 periods; up to 12 only from md up (a phone's columns are too
// narrow, so it keeps the highest); beyond that only the highest.
function labelled(values: (number | null)[]): Map<number, string> {
  let best = -1;
  values.forEach((v, i) => {
    if (v !== null && v > 0 && (best < 0 || v > values[best]!)) best = i;
  });
  const shown = new Map<number, string>();
  values.forEach((v, i) => {
    if (v === null) return;
    if (i === best || values.length <= 7) shown.set(i, "");
    else if (values.length <= 12) shown.set(i, "max-md:hidden");
  });
  return shown;
}

// Cap labels follow the axis format (1.4만 from 10,000) so they stay narrow;
// the hover card keeps the exact value.
const ValueLabel = ({ v, bottom, className = "" }: { v: number; bottom: string; className?: string }) => (
  <span
    className={`pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 pb-0.5 text-[10px] leading-none font-medium whitespace-nowrap tabular-nums text-foreground ${className}`}
    style={{ bottom }}
  >
    {formatTick(v, 1)}
  </span>
);

// A measured 0: a short dark tick standing on the baseline (the baseline
// itself is a lighter hairline), so 0 reads apart from both a bar and 미측정.
const ZeroTick = ({ className = "w-[64%] max-w-6" }: { className?: string }) => <div className={`h-[3px] shrink-0 rounded-full bg-muted-foreground/80 ${className}`} />;

// Stacked columns, one per period (two or more series add up to the
// period's total; one series is a plain column chart).
export function StackedBarChart(props: ChartProps) {
  const { labels, series, coverage } = props;
  const status = labels.map((_, i) => statusOf(i, series, coverage));
  const totals = labels.map((_, i) => (status[i] === "none" ? null : series.reduce((a, s) => a + (s.values[i] ?? 0), 0)));
  const scale = niceScale(Math.max(0, ...totals.map((t) => t ?? 0)), { integer: isInteger(series) });
  const shown = labelled(totals);
  return (
    <Frame
      {...props}
      scale={scale}
      status={status}
      total={(i) => totals[i]}
      zero={totals.includes(0)}
      column={(i) => {
        const t = totals[i];
        if (t === null) return null;
        if (t === 0)
          return (
            <>
              <ZeroTick />
              {shown.has(i) && <ValueLabel v={0} bottom="2px" className={shown.get(i)} />}
            </>
          );
        const h = `${(t / scale.top) * 100}%`;
        const parts = series.filter((s) => (s.values[i] ?? 0) > 0);
        return (
          <>
            <div className={`relative flex min-h-0.5 w-[64%] max-w-6 flex-col-reverse overflow-hidden rounded-t-[4px] ${status[i] === "partial" ? "opacity-60" : ""}`} style={{ height: h }}>
              {parts.map((s, k) => (
                <div key={s.label} className={`${TONE[s.tone].bg} ${k > 0 ? "border-b-2 border-card" : ""} shrink-0`} style={{ height: `${((s.values[i] ?? 0) / t) * 100}%` }} />
              ))}
              {status[i] === "partial" && <div className="chart-hatch-on absolute inset-0" />}
            </div>
            {shown.has(i) && <ValueLabel v={t} bottom={h} className={shown.get(i)} />}
          </>
        );
      }}
    />
  );
}

// Side-by-side columns per label, for two measures in the same unit
// (방문 시작 vs 추정 종료 by hour / weekday) or one series by category.
export function GroupedBarChart(props: ChartProps) {
  const { labels, series, coverage } = props;
  const status = labels.map((_, i) => statusOf(i, series, coverage));
  const scale = niceScale(Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0))), { integer: isInteger(series) });
  const shown = series.length === 1 ? labelled(series[0].values) : new Map<number, string>();
  return (
    <Frame
      {...props}
      scale={scale}
      status={status}
      zero={series.some((s) => s.values.includes(0))}
      column={(i) =>
        status[i] === "none" ? null : (
          <div className={`flex h-full w-[80%] items-end justify-center gap-0.5 ${series.length === 1 ? "max-w-6" : "max-w-9"}`}>
            {series.map((s) => {
              const v = s.values[i];
              if (v === null) return <div key={s.label} className="max-w-4 flex-1" />;
              if (v === 0)
                return (
                  <div key={s.label} className="relative flex max-w-4 flex-1 flex-col justify-end">
                    <ZeroTick className="w-full" />
                    {shown.has(i) && <ValueLabel v={0} bottom="2px" className={shown.get(i)} />}
                  </div>
                );
              const h = `${(v / scale.top) * 100}%`;
              return (
                <div key={s.label} className="relative h-full max-w-4 flex-1">
                  <div className={`absolute inset-x-0 bottom-0 min-h-0.5 rounded-t-[3px] ${TONE[s.tone].bg} ${status[i] === "partial" ? "chart-hatch-on opacity-60" : ""}`} style={{ height: h }} />
                  {shown.has(i) && <ValueLabel v={v} bottom={h} className={shown.get(i)} />}
                </div>
              );
            })}
          </div>
        )
      }
    />
  );
}

// A level over time (누적 가입): a 2px line with a faint area, dots at each
// period when they fit, the last value labelled. Kept apart from the
// per-period columns so a running total never reads as that period's count.
export function LineChart(props: ChartProps) {
  const { labels, series, coverage } = props;
  const n = labels.length;
  const status = labels.map((_, i) => statusOf(i, series, coverage));
  const measured = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const scale = niceRange(Math.min(...measured), Math.max(0, ...measured), { integer: isInteger(series) });
  const frac = (v: number) => (v - scale.bottom) / (scale.top - scale.bottom);
  const y = (v: number) => 100 - frac(v) * 100;
  const dots = n <= 16;
  const lastMeasured = series.map((s) => s.values.reduce<number>((last, v, i) => (v === null ? last : i), -1));
  return (
    <Frame
      {...props}
      scale={scale}
      status={status}
      overlay={
        <svg viewBox={`0 0 ${n * 100} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          {series.map((s) => {
            // unmeasured points break the line (a gap, never a dip to 0)
            const segments: [number, number][][] = [[]];
            s.values.forEach((v, i) => {
              if (v === null) {
                if (segments[segments.length - 1].length) segments.push([]);
              } else segments[segments.length - 1].push([i * 100 + 50, y(v)]);
            });
            return segments
              .filter((seg) => seg.length > 1)
              .map((seg, k) => (
                <g key={`${s.label}${k}`}>
                  {/* the area means "from 0": only drawn when the axis starts
                      there, and for a single line (several areas would overlap) */}
                  {scale.bottom === 0 && series.length === 1 && (
                    <polygon points={`${seg[0][0]},100 ${seg.map((p) => p.join(",")).join(" ")} ${seg[seg.length - 1][0]},100`} className={TONE[s.tone].fill} opacity={0.1} />
                  )}
                  <polyline
                    points={seg.map((p) => p.join(",")).join(" ")}
                    fill="none"
                    className={TONE[s.tone].stroke}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ));
          })}
        </svg>
      }
      column={(i) =>
        series.map((s, k) => {
          const v = s.values[i];
          if (v === null) return null;
          const end = i === lastMeasured[k];
          const bottom = `${frac(v) * 100}%`;
          const partial = s.status?.[i] === "partial";
          return (
            <span key={s.label}>
              <span
                className={`absolute left-1/2 size-2 -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-card ${
                  partial ? `border-2 bg-card ${TONE[s.tone].border}` : `${TONE[s.tone].bg} ${dots || end ? "" : "hidden group-hover:block group-focus:block"}`
                }`}
                style={{ bottom }}
              />
              {/* the last value, for a single line (several would collide; the hover card has them) */}
              {end && series.length === 1 && <span className="absolute left-1/2 -translate-x-1/2 pb-1.5 text-[10px] leading-none font-semibold tabular-nums text-foreground" style={{ bottom }}>{formatValue(v)}</span>}
            </span>
          );
        })
      }
    />
  );
}

export function Sparkline({ values }: { values: (number | null)[] }) {
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const n = Math.max(1, values.length - 1);
  // Unmeasured points are left out of the line (a gap, not a dip to 0).
  const segments: string[][] = [[]];
  values.forEach((v, i) => {
    if (v === null) {
      if (segments[segments.length - 1].length) segments.push([]);
      return;
    }
    segments[segments.length - 1].push(`${(i / n) * 100},${23 - (v / max) * 21}`);
  });
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="mt-auto h-6 w-full text-chart-1" aria-hidden>
      <line x1="0" y1="23" x2="100" y2="23" className="stroke-border" vectorEffect="non-scaling-stroke" />
      {segments
        .filter((s) => s.length)
        .map((s, i) =>
          s.length === 1 ? (
            <circle key={i} cx={s[0].split(",")[0]} cy={s[0].split(",")[1]} r="1" fill="currentColor" />
          ) : (
            <polyline key={i} points={s.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ),
        )}
    </svg>
  );
}

// Horizontal bars for a breakdown (유입 경로, 검색 유형 ...): the count and
// its share on the right, the bar's length relative to the largest row.
// `total`: the percentages' denominator when the rows are only the top few
// (otherwise the rows' own sum).
export function BarList({
  rows,
  empty = "아직 기록이 없습니다.",
  total: denominator,
  unit = "",
}: {
  rows: { label: string; value: number; note?: string }[];
  empty?: string;
  total?: number;
  unit?: string;
}) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = denominator ?? rows.reduce((a, r) => a + r.value, 0);
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.label} className="flex flex-col gap-1 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 break-keep text-foreground [overflow-wrap:anywhere]">{r.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              <span className="font-semibold text-foreground">
                {fmt(r.value)}
                {unit}
              </span>
              {total > 0 && <span className="ml-1 inline-block min-w-[2.25rem] text-right">{Math.round((r.value / total) * 100)}%</span>}
              {r.note && ` · ${r.note}`}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            {r.value > 0 ? (
              <div className="h-full min-w-1 rounded-full bg-chart-1" style={{ width: `${(r.value / max) * 100}%` }} />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Meter({ label, used, limit, unit }: { label: string; used: number; limit: number; unit: string }) {
  const pct = Math.round((used / limit) * 100);
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {fmt(used)}
          {unit} / {fmt(limit)}
          {unit} ({pct}%)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${pct >= 80 ? "bg-destructive" : pct >= 60 ? "bg-warning" : "bg-primary"}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

// Date × hour heatmap (시간대 분석): one row per KST day, 24 hour cells. A
// real table, so every value stays readable as a number (no hover needed
// on a phone) and screen readers get rows and columns. Shade = the cell
// against the largest one, in five steps of --chart-1 kept light enough for
// the number on top in both themes. 미측정 is the hatched grey band, 부분
// 측정 a hatched cell, a measured 0 a plain grey cell with a muted 0, and
// hours not reached yet stay empty. `extras`: summary columns after the
// hours (e.g. 오전 / 오후 / 합계), already formatted.
export type HeatmapCellStatus = Coverage | "future";
const HEAT_SHADES = [12, 22, 33, 44, 55];

export function HourHeatmap({
  title,
  unit,
  rows,
  extraLabels = [],
  note,
}: {
  title: string;
  unit: string;
  rows: { label: string; values: (number | null)[]; status: HeatmapCellStatus[]; extras?: ReactNode[] }[];
  extraLabels?: string[];
  note?: ReactNode;
}) {
  const max = Math.max(0, ...rows.flatMap((r) => r.values.map((v) => v ?? 0)));
  const statuses = new Set(rows.flatMap((r) => r.status));
  const hasZero = rows.some((r) => r.values.some((v, h) => v === 0 && r.status[h] !== "none"));
  const shade = (v: number) => HEAT_SHADES[Math.min(HEAT_SHADES.length - 1, Math.max(0, Math.ceil((v / max) * HEAT_SHADES.length) - 1))];
  const cellText = (v: number | null, s: HeatmapCellStatus) =>
    s === "future" ? "아직 지나지 않음" : s === "none" || v === null ? "미측정" : `${fmt(v)}${unit}${s === "partial" ? " (부분 측정)" : ""}`;
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-foreground">
          {title}
          <span className="ml-1 font-normal text-muted-foreground">(단위: {unit}, 한국 시간)</span>
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            적음
            {HEAT_SHADES.map((p) => (
              <span key={p} className="inline-block size-2.5 rounded-[3px]" style={{ backgroundColor: `color-mix(in srgb, var(--chart-1) ${p}%, transparent)` }} aria-hidden />
            ))}
            많음{max > 0 && ` (최대 ${fmt(max)}${unit})`}
          </span>
          {hasZero && (
            <span className="flex items-center gap-1">
              <Swatch className="bg-muted" />
              {`0${unit}`}
            </span>
          )}
          {statuses.has("partial") && (
            <span className="flex items-center gap-1">
              <Swatch className="chart-hatch-on bg-chart-1/40" />
              부분 측정
            </span>
          )}
          {statuses.has("none") && (
            <span className="flex items-center gap-1">
              <Swatch className="chart-hatch border border-border bg-muted" />
              미측정(수집 전)
            </span>
          )}
          {statuses.has("future") && (
            <span className="flex items-center gap-1">
              <Swatch className="border border-dashed border-border" />
              아직 지나지 않음
            </span>
          )}
        </div>
      </figcaption>
      {/* relative: keeps the cells' sr-only (absolute) text inside the scroll box */}
      <div className="relative overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[46rem] border-separate border-spacing-0.5 text-center text-[10px] leading-none tabular-nums">
          <caption className="sr-only">{`${title} (단위: ${unit}). 행은 날짜, 열은 0시부터 23시까지의 한국 시간`}</caption>
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-card px-1.5 py-1 text-left font-medium">
                날짜
              </th>
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} scope="col" className="py-1 font-medium">
                  <span className="sr-only">{h}시</span>
                  <span aria-hidden>{h}</span>
                </th>
              ))}
              {extraLabels.map((l) => (
                <th key={l} scope="col" className="px-1 py-1 font-medium whitespace-nowrap">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="sticky left-0 z-10 bg-card px-1.5 text-left font-medium whitespace-nowrap text-foreground">
                  {r.label}
                </th>
                {r.values.map((v, h) => {
                  const s = r.status[h];
                  const label = `${r.label} ${h}시: ${cellText(v, s)}`;
                  if (s === "future") return <td key={h} title={label} className="h-7 min-w-6 rounded-[3px] border border-dashed border-border/70" />;
                  if (s === "none" || v === null)
                    return (
                      <td key={h} title={label} className="chart-hatch h-7 min-w-6 rounded-[3px] bg-muted/60">
                        <span className="sr-only">미측정</span>
                      </td>
                    );
                  return (
                    <td
                      key={h}
                      title={label}
                      className={`relative h-7 min-w-6 rounded-[3px] ${v === 0 ? "bg-muted text-muted-foreground/70" : "font-medium text-foreground"} ${s === "partial" ? "chart-hatch-on" : ""}`}
                      style={v > 0 ? { backgroundColor: `color-mix(in srgb, var(--chart-1) ${shade(v)}%, transparent)` } : undefined}
                    >
                      {formatTick(v, 1)}
                      {s === "partial" && <span className="sr-only"> (부분 측정)</span>}
                    </td>
                  );
                })}
                {(r.extras ?? []).map((x, k) => (
                  <td key={k} className="px-1 font-semibold whitespace-nowrap text-foreground">
                    {x}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <div className="text-[11px] leading-relaxed text-muted-foreground">{note}</div>}
    </figure>
  );
}
