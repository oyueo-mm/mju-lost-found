// 운영 통계 charts: plain SVG / CSS drawn on the server -- no chart library,
// no client JS. Bars stretch with the card; every label is HTML so it stays
// readable at any width. A period before a count began (미측정) is drawn as
// one faint band per run of such periods (labelled, never a zero bar); a
// measured 0 is a thin tick on the baseline, so the two stay apart while
// the real bars stand out.

const fmt = (n: number) => n.toLocaleString("ko-KR");

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
    segments[segments.length - 1].push(`${(i / n) * 100},${24 - (v / max) * 22}`);
  });
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full text-primary" aria-hidden>
      {segments
        .filter((s) => s.length)
        .map((s, i) =>
          s.length === 1 ? (
            <circle key={i} cx={s[0].split(",")[0]} cy={s[0].split(",")[1]} r="1" fill="currentColor" />
          ) : (
            <polyline key={i} points={s.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          ),
        )}
    </svg>
  );
}

export type ChartSeries = { label: string; values: (number | null)[]; className: string; swatch: string };

// Stacked columns, one per period.
export function StackedBarChart({ labels, series, title }: { labels: string[]; series: ChartSeries[]; title: string }) {
  const n = labels.length;
  const totals = labels.map((_, i) => (series.every((s) => s.values[i] === null) ? null : series.reduce((a, s) => a + (s.values[i] ?? 0), 0)));
  const max = Math.max(1, ...totals.map((t) => t ?? 0));
  const W = 100 * n;
  const H = 100;
  const tickEvery = Math.max(1, Math.ceil(n / 6));
  // runs of consecutive 미측정 periods: [first, last + 1)
  const runs: [number, number][] = [];
  totals.forEach((t, i) => {
    if (t !== null) return;
    const lastRun = runs[runs.length - 1];
    if (lastRun && lastRun[1] === i) lastRun[1] = i + 1;
    else runs.push([i, i + 1]);
  });
  const hasUnmeasured = runs.length > 0;
  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="text-xs font-semibold text-foreground">{title}</span>
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1">
            <span className={`inline-block size-2.5 rounded-sm ${s.swatch}`} aria-hidden />
            {s.label}
          </span>
        ))}
        {hasUnmeasured && (
          <span className="flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-sm bg-muted" aria-hidden />
            미측정(수집 전)
          </span>
        )}
      </figcaption>
      <div className="relative">
        <span className="absolute top-0 left-0 rounded bg-card/80 px-0.5 text-[10px] leading-none tabular-nums text-muted-foreground">
          최대 {fmt(max)}
        </span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-28 w-full" role="img" aria-label={`${title} 그래프`}>
          {runs.map(([a, b]) => (
            <rect key={`u${a}`} x={a * 100} y={0} width={(b - a) * 100} height={H} className="fill-muted" opacity={0.55}>
              <title>{`${labels[a]}${b - a > 1 ? ` ~ ${labels[b - 1]}` : ""}: 미측정(수집 전)`}</title>
            </rect>
          ))}
          <line x1="0" y1={H / 2} x2={W} y2={H / 2} className="stroke-border" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1={H} x2={W} y2={H} className="stroke-border" vectorEffect="non-scaling-stroke" />
          {labels.map((label, i) => {
            const x = i * 100 + 15;
            if (totals[i] === null) return null;
            let y = H;
            return (
              <g key={label}>
                <title>{`${label}: ${series.map((s) => `${s.label} ${fmt(s.values[i] ?? 0)}`).join(", ")}`}</title>
                {totals[i] === 0 && <rect x={x} y={H - 2} width={70} height={2} className="fill-border" />}
                {series.map((s) => {
                  const h = ((s.values[i] ?? 0) / max) * (H - 4);
                  y -= h;
                  return h > 0 ? <rect key={s.label} x={x} y={y} width={70} height={h} className={s.className} /> : null;
                })}
              </g>
            );
          })}
        </svg>
        {runs
          .filter(([a, b]) => (b - a) / n >= 0.15)
          .map(([a, b]) => (
            <span
              key={`l${a}`}
              aria-hidden
              className="absolute top-1/2 -translate-y-1/2 text-center text-[10px] text-muted-foreground"
              style={{ left: `${(a / n) * 100}%`, width: `${((b - a) / n) * 100}%` }}
            >
              미측정
            </span>
          ))}
      </div>
      <div className="flex text-[10px] tabular-nums text-muted-foreground">
        {labels.map((label, i) => (
          <span key={label} className="flex-1 text-center" aria-hidden={i % tickEvery !== 0}>
            {i % tickEvery === 0 ? label : ""}
          </span>
        ))}
      </div>
    </figure>
  );
}

// Horizontal bars for a breakdown (유입 경로, 검색 유형 ...).
// `total`: the percentages' denominator when the rows are only the top few
// (otherwise the rows' own sum).
export function BarList({
  rows,
  empty = "아직 기록이 없습니다.",
  total: denominator,
}: {
  rows: { label: string; value: number; note?: string }[];
  empty?: string;
  total?: number;
}) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = denominator ?? rows.reduce((a, r) => a + r.value, 0);
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <li key={r.label} className="flex flex-col gap-0.5 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-foreground">{r.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              <span className="font-semibold text-foreground">{fmt(r.value)}</span>
              {total > 0 && ` · ${Math.round((r.value / total) * 100)}%`}
              {r.note && ` · ${r.note}`}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
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

// Side-by-side columns per label (방문 시작 vs 추정 이탈 by hour / weekday).
export function GroupedBarChart({ labels, series, title, tickEvery = 1 }: { labels: string[]; series: ChartSeries[]; title: string; tickEvery?: number }) {
  const n = labels.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const W = 100 * n;
  const H = 100;
  const width = 80 / series.length;
  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="text-xs font-semibold text-foreground">{title}</span>
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1">
            <span className={`inline-block size-2.5 rounded-sm ${s.swatch}`} aria-hidden />
            {s.label}
          </span>
        ))}
      </figcaption>
      <div className="relative">
        <span className="absolute top-0 left-0 rounded bg-card/80 px-0.5 text-[10px] leading-none tabular-nums text-muted-foreground">최대 {fmt(max)}</span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-28 w-full" role="img" aria-label={`${title} 그래프`}>
          <line x1="0" y1={H / 2} x2={W} y2={H / 2} className="stroke-border" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1={H} x2={W} y2={H} className="stroke-border" vectorEffect="non-scaling-stroke" />
          {labels.map((label, i) => (
            <g key={label}>
              <title>{`${label}: ${series.map((s) => `${s.label} ${fmt(s.values[i] ?? 0)}`).join(", ")}`}</title>
              {series.map((s, j) => {
                const h = ((s.values[i] ?? 0) / max) * (H - 4);
                return h > 0 ? <rect key={s.label} x={i * 100 + 10 + j * width} y={H - h} width={width - 2} height={h} className={s.className} /> : null;
              })}
            </g>
          ))}
        </svg>
      </div>
      <div className="flex text-[10px] tabular-nums text-muted-foreground">
        {labels.map((label, i) => (
          <span key={label} className="flex-1 text-center" aria-hidden={i % tickEvery !== 0}>
            {i % tickEvery === 0 ? label : ""}
          </span>
        ))}
      </div>
    </figure>
  );
}
