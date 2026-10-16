import Link from "next/link";
import type { ReactNode } from "react";

import { GroupedBarChart, HourHeatmap, LineChart, StackedBarChart, type ChartSeries, type ChartTone } from "@/components/admin/StatsCharts";
import { More, Section, StatTile, SubHeading, Unmeasured } from "@/components/admin/StatsBlocks";
import { LAST_ACTIVE_INTERVAL_MINUTES } from "@/lib/metrics/activityTime";
import { describeDays, MAX_SELECTED_DAYS } from "@/lib/metrics/daySelection";
import {
  byHour,
  halves,
  HOURLY_METRICS,
  metricInfo,
  peakHour,
  totalOf,
  type CellStatus,
  type HourlyCells,
  type HourlyMetric,
  type MetricCells,
} from "@/lib/metrics/hourly";
import type { Coverage } from "@/lib/metrics/report";

// 시간대 분석 (a section of 운영 통계): the service's use by KST hour on the
// days chosen on the calendar (HourlyDayPicker) -- any set of days, never
// the days in between. How it is drawn follows the count: one day as its
// own hours, 2-4 days as one line each, 5 or more as a date x hour heatmap
// plus the hours added up (no day is ever dropped). Server only; every
// number comes from lib/metrics/hourly.ts, the same cells the export uses.

const fmt = (n: number) => n.toLocaleString("ko-KR");
const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (day: string) => `${md(day)}(${DOW[new Date(`${day}T00:00:00Z`).getUTCDay()]})`;
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${h}시`);
// Up to this many days are drawn as one line each.
export const MAX_LINE_DAYS = 4;

// Charts take Coverage; hours not reached yet are cut off before this.
const asCoverage = (s: CellStatus): Coverage => (s === "future" ? "full" : s);

function valueText(value: number | null, status: CellStatus, unit: string): ReactNode {
  if (status === "future") return <span className="text-muted-foreground/70">-</span>;
  if (value === null || status === "none") return <span className="font-normal text-muted-foreground/70">미측정</span>;
  return (
    <>
      {fmt(value)}
      {unit}
      {status === "partial" && <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">(부분)</span>}
    </>
  );
}

function hourSeries(cells: MetricCells, label: string, tone: ChartTone, hours: number): ChartSeries & { coverage: Coverage[] } {
  const p = byHour(cells);
  return { label, tone, values: p.values.slice(0, hours), coverage: p.status.slice(0, hours).map(asCoverage) };
}

// The chosen metric added up hour by hour over the chosen days (page views
// split by login state).
function HourTotals({ cells, metric, title, hours, inProgress, note }: { cells: HourlyCells; metric: HourlyMetric; title: string; hours: number; inProgress: boolean; note?: ReactNode }) {
  const info = metricInfo(metric);
  const labels = HOUR_LABELS.slice(0, hours);
  if (metric === "pv") {
    const all = byHour(cells.metrics.pv);
    return (
      <StackedBarChart
        title={title}
        unit="회"
        labels={labels}
        tickEvery={3}
        series={[hourSeries(cells.metrics.pvMember, "로그인 회원", 1, hours), hourSeries(cells.metrics.pvAnon, "비로그인", 2, hours)]}
        coverage={all.status.slice(0, hours).map(asCoverage)}
        inProgress={inProgress}
        note={note}
      />
    );
  }
  const s = hourSeries(cells.metrics[metric], info.short, metric === "login" ? 2 : 1, hours);
  return <GroupedBarChart title={title} unit={info.unit} labels={labels} tickEvery={3} series={[s]} coverage={s.coverage} inProgress={inProgress} note={note} />;
}

// 오전 / 오후 / 하루 합계 and the busiest hour of each chosen day.
function DayTable({ cells, metric }: { cells: HourlyCells; metric: HourlyMetric }) {
  const info = metricInfo(metric);
  const c = cells.metrics[metric];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] text-right text-xs tabular-nums">
        <caption className="sr-only">{`${info.label} 날짜별 오전·오후 합계`}</caption>
        <thead className="text-muted-foreground">
          <tr>
            <th scope="col" className="py-1.5 pr-2 text-left font-medium">날짜</th>
            <th scope="col" className="py-1.5 pr-2 font-medium">오전 (0~11시)</th>
            <th scope="col" className="py-1.5 pr-2 font-medium">오후 (12~23시)</th>
            <th scope="col" className="py-1.5 pr-2 font-medium">하루 합계</th>
            <th scope="col" className="py-1.5 pr-2 font-medium">최다 시간대</th>
          </tr>
        </thead>
        <tbody>
          {cells.days.map((day, d) => {
            const half = halves(c, d);
            const top = peakHour(c.values[d]);
            return (
              <tr key={day} className="border-t border-border">
                <th scope="row" className="py-1.5 pr-2 text-left font-medium text-foreground">
                  {day} ({DOW[new Date(`${day}T00:00:00Z`).getUTCDay()]})
                </th>
                <td className="py-1.5 pr-2">{valueText(half.am.value, half.am.status, info.unit)}</td>
                <td className="py-1.5 pr-2">{valueText(half.pm.value, half.pm.status, info.unit)}</td>
                <td className="py-1.5 pr-2 font-semibold">{valueText(half.day.value, half.day.status, info.unit)}</td>
                <td className="py-1.5 pr-2">{top ? `${top.hour}시 (${fmt(top.n)}${info.unit})` : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function HourlyStatsView({
  cells,
  metric,
  hrefWith,
  today,
  picker,
  actions,
  notice,
}: {
  cells: HourlyCells; // the chosen days, in order
  metric: HourlyMetric;
  // this page's URL with the metric replaced (days and period kept)
  hrefWith: (metric: HourlyMetric) => string;
  today: string;
  picker: ReactNode; // the calendar
  actions?: ReactNode; // downloads of the same days
  notice?: string | null;
}) {
  const info = metricInfo(metric);
  const m = cells.metrics;
  const c = m[metric];
  const n = cells.days.length;
  // only today chosen: the hours still to come are left off the axis
  const onlyToday = n > 0 && cells.days.every((d) => d === today);
  const hours = onlyToday ? cells.nowHour + 1 : 24;
  const hasToday = cells.days.includes(today);
  const total = (x: MetricCells) => totalOf(x);
  const pvMember = total(m.pvMember);
  const pvAnon = total(m.pvAnon);
  const busiestActive = (() => {
    let best: { d: number; h: number; n: number } | null = null;
    m.active.values.forEach((row, d) =>
      row.forEach((v, h) => {
        if (v !== null && v > 0 && (!best || v > best.n)) best = { d, h, n: v };
      }),
    );
    return best as { d: number; h: number; n: number } | null;
  })();
  const profile = byHour(c);
  const peak = peakHour(profile.values);
  const sinceLine = HOURLY_METRICS.filter((x) => x.key !== "pv")
    .map((x) => `${x.short} ${m[x.key].since ? `${m[x.key].since}부터` : "수집 전"}`)
    .join(" · ");
  const todayNote = hasToday ? `오늘(${md(today)})은 ${cells.nowHour}시까지의 값입니다.` : undefined;

  return (
    <Section
      title="시간대 분석"
      description={
        <>
          <p>
            달력에서 고른 날짜만 한국 시간 0~23시별로 집계합니다. 떨어진 날짜도 함께 고를 수 있어, 축제·홍보 글·사건 전후의 시간대별 이용량을 비교할 때
            씁니다. 위 조회 기간과는 별개이며, 회원별 기록이 아닌 시간대별 합계만 쓰고 관리자의 이용은 포함하지 않습니다.
          </p>
          <More label="지표 정의와 측정 범위">
            <ul className="flex list-disc flex-col gap-1 pl-4">
              <li>
                <b className="font-semibold">페이지뷰</b>: 화면이 열린 횟수. 볼 때의 로그인 여부로 회원·비로그인을 나눕니다(전체 = 두 값의 합).
              </li>
              <li>
                <b className="font-semibold">방문 세션</b>: 그 시간에 <b className="font-semibold">시작된</b> 방문 수(30분 넘게 조회가 없거나 날짜가 바뀌면 새
                방문). 사람 수가 아닙니다.
              </li>
              <li>
                <b className="font-semibold">시간대별 활성 회원</b>: 그 시간에 로그인 상태 활동이 한 번이라도 감지된 서로 다른 회원 수(사람 수, 시간대마다 따로
                셈). 여러 시간·날짜를 더한 값은 사람 수가 아니라 &lsquo;회원·시간&rsquo; 수입니다.
              </li>
              <li>
                <b className="font-semibold">로그인 완료</b>: Google 로그인을 새로 마친 횟수. 로그인은 최대 30일 유지되므로 이용량보다 훨씬 적습니다.
              </li>
              <li>
                지표마다 수집 시작 시점이 다릅니다: {sinceLine}. 그 전은 <b className="font-semibold">미측정</b>(0이 아님)이고, 수집을 시작한 시간은 부분
                측정입니다. 미측정 기간의 시간대별 수치는 추정·복원하지 않습니다.
              </li>
              <li>
                1일은 그날의 시간대별 막대, 2~{MAX_LINE_DAYS}일은 날짜별 선, 5일 이상은 선이 겹치지 않도록 날짜 × 시간대 히트맵과 시간대별 합계로 보여
                줍니다. 고른 날짜는 모두 반영하며, 고르지 않은 날짜는 집계하지 않습니다. 최대 {MAX_SELECTED_DAYS}일.
              </li>
              <li>
                활성 회원 감지는 화면을 열거나 보이는 화면을 조작할 때 이뤄지며, 이미 그 시간에 감지된 회원은 다시 세지 않습니다(최근 활동 시각 갱신은{" "}
                {LAST_ACTIVE_INTERVAL_MINUTES}분 간격). 자바스크립트가 꺼진 브라우저·자동화 도구의 방문은 세지 않을 수 있습니다.
              </li>
            </ul>
          </More>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        {picker}
        <div className="flex min-w-0 flex-col gap-4">
          {notice && (
            <p role="alert" className="text-xs text-destructive">
              {notice}
            </p>
          )}
          <nav className="flex flex-wrap gap-2" aria-label="분석 지표">
            {HOURLY_METRICS.map((x) => (
              <Link
                key={x.key}
                href={hrefWith(x.key)}
                scroll={false}
                aria-current={x.key === metric ? "page" : undefined}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  x.key === metric ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {x.label}
              </Link>
            ))}
          </nav>
          {n === 0 ? (
            <p className="text-xs text-muted-foreground">달력에서 날짜를 골라 주세요.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              <StatTile
                label="페이지뷰(전체)"
                value={valueText(total(m.pv).value, total(m.pv).status, "회")}
                sub={
                  <>
                    회원 {valueText(pvMember.value, pvMember.status, "")} · 비로그인 {valueText(pvAnon.value, pvAnon.status, "")}
                  </>
                }
              />
              <StatTile label="방문 세션(시작)" value={valueText(total(m.session).value, total(m.session).status, "회")} sub="방문 횟수, 사람 수 아님" />
              <StatTile
                label="활성 회원 최다 시간"
                value={busiestActive ? `${fmt(busiestActive.n)}명` : total(m.active).status === "none" ? <Unmeasured /> : "0명"}
                sub={busiestActive ? `${dayLabel(cells.days[busiestActive.d])} ${busiestActive.h}시` : "한 시간 안의 서로 다른 회원 수"}
              />
              <StatTile label="로그인 완료" value={valueText(total(m.login).value, total(m.login).status, "회")} sub="Google 로그인을 새로 마친 수" />
              <StatTile
                label={`${info.short} 최다 시간대`}
                value={peak ? `${peak.hour}시` : profile.status.every((s) => s === "none" || s === "future") ? <Unmeasured /> : "-"}
                sub={peak ? `고른 날짜 합계 ${fmt(peak.n)}${info.unit}` : "기록 없음"}
              />
            </div>
          )}
          {actions}
        </div>
      </div>

      {n === 1 && (
        <>
          <HourTotals cells={cells} metric={metric} title={`${dayLabel(cells.days[0])} ${info.label} · 시간대별`} hours={hours} inProgress={onlyToday} note={todayNote} />
          <DayTable cells={cells} metric={metric} />
        </>
      )}

      {n >= 2 && n <= MAX_LINE_DAYS && (
        <>
          <LineChart
            title={`${info.label} · 날짜별 비교`}
            unit={info.unit}
            labels={HOUR_LABELS.slice(0, hours)}
            tickEvery={3}
            series={cells.days.map((day, d) => ({ label: dayLabel(day), tone: ((d % 4) + 1) as ChartTone, values: c.values[d].slice(0, hours) }))}
            coverage={Array.from({ length: hours }, (_, h): Coverage => {
              const s = cells.days.map((_, d) => c.status[d][h]).filter((x) => x !== "future");
              if (s.includes("partial")) return "partial";
              return s.some((x) => x === "full") ? "full" : "none";
            })}
            note={todayNote}
          />
          <DayTable cells={cells} metric={metric} />
        </>
      )}

      {n > MAX_LINE_DAYS && (
        <>
          <div className="flex flex-col gap-2">
            <SubHeading basis={`${n}일 · 고른 날짜만, 날짜 순`}>{describeDays(cells.days)}</SubHeading>
            <HourHeatmap
              title={info.label}
              unit={info.unit}
              extraLabels={["오전", "오후", "합계"]}
              rows={cells.days.map((day, d) => {
                const half = halves(c, d);
                return {
                  label: dayLabel(day),
                  values: c.values[d],
                  status: c.status[d],
                  extras: [half.am, half.pm, half.day].map((x) => valueText(x.value, x.status, "")),
                };
              })}
              note={metric === "active" ? "칸마다 그 시간의 서로 다른 회원 수입니다. 오전·오후·합계는 시간별 수를 더한 '회원·시간' 수입니다." : todayNote}
            />
          </div>
          <HourTotals
            cells={cells}
            metric={metric}
            title={`${info.label} · 고른 ${n}일의 시간대별 합계`}
            hours={24}
            inProgress={hasToday}
            note={metric === "active" ? "여러 날을 더한 값이라 사람 수가 아닌 '회원·시간' 수입니다." : undefined}
          />
        </>
      )}
    </Section>
  );
}
