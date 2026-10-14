import Link from "next/link";

import { requireAdmin } from "@/lib/auth/session";
import {
  loadComparison,
  loadSeries,
  loadTimings,
  METRICS,
  PERIODS,
  type Granularity,
  type TimingRow,
} from "@/lib/metrics/dashboard";
import { kstDay } from "@/lib/metrics/record";

// 운영 통계 (admin only). Read-only aggregates: no search text, no member
// names -- 활성 이용자 are counted from HMAC'd daily marks.
const UNITS: { unit: Granularity; label: string }[] = [
  { unit: "day", label: `일별 (${PERIODS.day}일)` },
  { unit: "week", label: `주별 (${PERIODS.week}주)` },
  { unit: "month", label: `월별 (${PERIODS.month}개월)` },
];
const WINDOWS = [7, 14, 30] as const;

const bucketLabel = (bucket: string, unit: Granularity) => {
  const [, m, d] = bucket.split("-").map(Number);
  return unit === "month" ? `${bucket.slice(0, 4)}.${m}` : unit === "week" ? `${m}/${d}주` : `${m}/${d}`;
};

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const points = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${24 - (v / max) * 22}`).join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full text-primary" aria-hidden>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function change(before: number, after: number): string {
  if (before === 0) return after === 0 ? "-" : "신규";
  const pct = Math.round(((after - before) / before) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

function TimingTable({ rows, empty }: { rows: TimingRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1.5 pr-3 font-medium">경로</th>
            <th className="py-1.5 pr-3 text-right font-medium">요청</th>
            <th className="py-1.5 pr-3 text-right font-medium">오류율</th>
            <th className="py-1.5 pr-3 text-right font-medium">평균</th>
            <th className="py-1.5 pr-3 text-right font-medium">p50</th>
            <th className="py-1.5 text-right font-medium">p95</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.route} className="border-t border-border">
              <td className="py-1.5 pr-3 font-mono text-[11px] break-all text-foreground">{r.route}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{r.count.toLocaleString("ko-KR")}</td>
              <td className={`py-1.5 pr-3 text-right tabular-nums ${r.errors > 0 ? "text-destructive" : ""}`}>
                {r.count ? `${((r.errors / r.count) * 100).toFixed(1)}%` : "-"}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{r.avgMs}ms</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{r.p50}</td>
              <td className="py-1.5 text-right tabular-nums">{r.p95}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; pivot?: string; window?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const unit: Granularity = params.unit === "week" || params.unit === "month" ? params.unit : "day";
  const pivot = /^\d{4}-\d{2}-\d{2}$/.test(params.pivot ?? "") && !Number.isNaN(Date.parse(params.pivot!)) ? params.pivot! : null;
  const windowDays = WINDOWS.includes(Number(params.window) as (typeof WINDOWS)[number]) ? Number(params.window) : 14;

  const [series, comparison, timings24h, timings7d] = await Promise.all([
    loadSeries(unit),
    pivot ? loadComparison(pivot, windowDays) : Promise.resolve(null),
    loadTimings(24),
    loadTimings(24 * 7),
  ]);
  const isInternal = (r: TimingRow) => r.route.startsWith("ai:") || r.route.startsWith("db:");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/admin" className="text-xs text-muted-foreground hover:text-foreground">
          ← 관리자
        </Link>
        <h1 className="text-xl font-semibold text-foreground">운영 통계</h1>
        <p className="text-xs leading-relaxed text-muted-foreground">
          모든 날짜는 한국 시간 기준입니다. 검색어 원문과 개인정보는 수집하지 않으며, 활성 이용자는 하루 한 번 남기는 비식별
          방문 기록으로 셉니다. 검색·추천·활성 이용자·응답 시간은 통계 기능 도입 이후부터 집계됩니다.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="집계 단위">
        {UNITS.map((u) => (
          <Link
            key={u.unit}
            href={`/admin/stats?unit=${u.unit}${pivot ? `&pivot=${pivot}&window=${windowDays}` : ""}`}
            aria-current={u.unit === unit ? "page" : undefined}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
              u.unit === unit ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {u.label}
          </Link>
        ))}
      </nav>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {METRICS.map((m) => {
          const values = series.values[m.key];
          const total = m.key === "active" ? null : values.reduce((a, b) => a + b, 0);
          return (
            <div key={m.key} className="flex flex-col gap-1 rounded-card border border-border bg-card p-3">
              <span className="text-xs text-muted-foreground">{m.label}</span>
              <span className="text-lg font-bold tabular-nums text-foreground">
                {(total ?? values[values.length - 1]).toLocaleString("ko-KR")}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {total === null ? "이번 기간" : "기간 합계"} · 최근 {values[values.length - 1].toLocaleString("ko-KR")}
              </span>
              <Sparkline values={values} />
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">기간별 추이</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-right text-xs tabular-nums">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-2 text-left font-medium">기간</th>
                {METRICS.map((m) => (
                  <th key={m.key} className="py-1.5 pr-2 font-medium">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.buckets
                .map((bucket, i) => ({ bucket, i }))
                .reverse()
                .map(({ bucket, i }) => (
                  <tr key={bucket} className="border-t border-border">
                    <td className="py-1.5 pr-2 text-left text-foreground">{bucketLabel(bucket, unit)}</td>
                    {METRICS.map((m) => (
                      <td key={m.key} className="py-1.5 pr-2">
                        {series.values[m.key][i] || <span className="text-muted-foreground/60">0</span>}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">홍보 전후 비교</h2>
        <form action="/admin/stats" className="flex flex-wrap items-end gap-2 text-sm">
          <input type="hidden" name="unit" value={unit} />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            기준일(홍보 시작일)
            <input
              type="date"
              name="pivot"
              defaultValue={pivot ?? kstDay()}
              className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            비교 기간
            <select
              name="window"
              defaultValue={String(windowDays)}
              className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
            >
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  앞뒤 {w}일
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
            비교하기
          </button>
        </form>
        {comparison && pivot && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-right text-xs tabular-nums">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 text-left font-medium">지표</th>
                  <th className="py-1.5 pr-3 font-medium">이전 {windowDays}일</th>
                  <th className="py-1.5 pr-3 font-medium">이후 {windowDays}일</th>
                  <th className="py-1.5 font-medium">변화</th>
                </tr>
              </thead>
              <tbody>
                {METRICS.map((m) => (
                  <tr key={m.key} className="border-t border-border">
                    <td className="py-1.5 pr-3 text-left text-foreground">{m.label}</td>
                    <td className="py-1.5 pr-3">{comparison.before[m.key].toLocaleString("ko-KR")}</td>
                    <td className="py-1.5 pr-3">{comparison.after[m.key].toLocaleString("ko-KR")}</td>
                    <td className="py-1.5">{change(comparison.before[m.key], comparison.after[m.key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              이전: 기준일 전 {windowDays}일, 이후: 기준일 포함 {windowDays}일. 활성 이용자는 각 기간의 서로 다른 회원 수입니다.
            </p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">API 응답 시간·오류율</h2>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          서버 인스턴스마다 최대 1분 단위로 모아 기록합니다(인스턴스가 종료되면 마지막 1분 이내 값은 빠질 수 있음). p50/p95는
          구간 상한값으로 표시합니다. 오류율은 5xx 응답 비율입니다.
        </p>
        <h3 className="text-xs font-semibold text-foreground">최근 24시간</h3>
        <TimingTable rows={timings24h.filter((r) => !isInternal(r))} empty="아직 기록이 없습니다." />
        <h3 className="text-xs font-semibold text-foreground">최근 7일</h3>
        <TimingTable rows={timings7d.filter((r) => !isInternal(r))} empty="아직 기록이 없습니다." />
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">AI 추론·DB 지연 (최근 7일)</h2>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          ai:*-load는 인스턴스당 한 번의 모델 로딩(콜드 스타트), ai:*-embed는 1건 추론, db:ping은 기록할 때마다 잰 DB 왕복
          시간입니다.
        </p>
        <TimingTable rows={timings7d.filter(isInternal)} empty="아직 기록이 없습니다." />
      </section>
    </div>
  );
}
