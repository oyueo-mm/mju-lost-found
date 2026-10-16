import Link from "next/link";
import type { ReactNode } from "react";

import { GroupedBarChart, HourHeatmap, LineChart, StackedBarChart, type ChartSeries, type ChartTone } from "@/components/admin/StatsCharts";
import { More, Section, StatTile, SubHeading, Unmeasured } from "@/components/admin/StatsBlocks";
import { LAST_ACTIVE_INTERVAL_MINUTES } from "@/lib/metrics/activityTime";
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

// 시간대 분석 tab of /admin/stats: the service's use by KST day and hour for
// the chosen period, plus up to four days compared hour by hour. Server
// only; every number comes from lib/metrics/hourly.ts (aggregate counters).

const fmt = (n: number) => n.toLocaleString("ko-KR");
const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (day: string) => `${md(day)}(${DOW[new Date(`${day}T00:00:00Z`).getUTCDay()]})`;
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${h}시`);
export const MAX_COMPARE_DAYS = 4;
// Hour-by-hour trend over consecutive days: up to a week (168 points).
const TREND_MAX_DAYS = 7;
// Heatmap rows: up to a month; a longer period shows its last 31 days.
const HEATMAP_MAX_DAYS = 31;

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

function hourSeries(cells: MetricCells, label: string, tone: ChartTone, rows?: number[], hours = 24): ChartSeries & { coverage: Coverage[] } {
  const p = byHour(cells, rows);
  return { label, tone, values: p.values.slice(0, hours), coverage: p.status.slice(0, hours).map(asCoverage) };
}

export function HourlyStatsView({
  range,
  compare,
  metric,
  compareDays,
  hrefWith,
  hiddenFields,
  today,
}: {
  range: HourlyCells;
  compare: HourlyCells;
  metric: HourlyMetric;
  compareDays: string[];
  // this tab's URL with the period kept and the given params replaced
  hrefWith: (params: { m?: HourlyMetric; d?: string[] }) => string;
  // the period (and metric) as hidden inputs for the compare form
  hiddenFields: { name: string; value: string }[];
  today: string;
}) {
  const info = metricInfo(metric);
  const cells = range.metrics[metric];
  const m = range.metrics;
  // only today in the period: the hours still to come are left off the axis
  const onlyToday = range.days.length === 1 && range.days[0] === today;
  const hours = onlyToday ? range.nowHour + 1 : 24;
  const hourLabels = HOUR_LABELS.slice(0, hours);
  const pvMember = totalOf(m.pvMember);
  const pvAnon = totalOf(m.pvAnon);
  const sessions = totalOf(m.session);
  const logins = totalOf(m.login);
  const profile = byHour(cells);
  const peak = peakHour(profile.values);
  const busiestActive = (() => {
    let best: { d: number; h: number; n: number } | null = null;
    m.active.values.forEach((row, d) => row.forEach((v, h) => {
      if (v !== null && v > 0 && (!best || v > best.n)) best = { d, h, n: v };
    }));
    return best as { d: number; h: number; n: number } | null;
  })();
  const sinceLine = HOURLY_METRICS.filter((x) => x.key !== "pv")
    .map((x) => `${x.short} ${range.metrics[x.key].since ? `${range.metrics[x.key].since}부터` : "수집 전"}`)
    .join(" · ");

  // hour-by-hour trend over the period's days (up to a week)
  const trendDays = range.days.length <= TREND_MAX_DAYS ? range.days : null;
  const trendPoints = trendDays
    ? trendDays.flatMap((day, d) =>
        Array.from({ length: 24 }, (_, h) => ({ day, d, h })).filter(({ day: x, h }) => x < today || (x === today && h <= range.nowHour)),
      )
    : [];
  const trendSeries: ChartSeries[] =
    metric === "pv"
      ? [
          { label: "로그인 회원", tone: 1, values: trendPoints.map(({ d, h }) => m.pvMember.values[d][h]) },
          { label: "비로그인", tone: 2, values: trendPoints.map(({ d, h }) => m.pvAnon.values[d][h]) },
        ]
      : [{ label: info.short, tone: 1, values: trendPoints.map(({ d, h }) => cells.values[d][h]) }];
  const trendCoverage = trendPoints.map(({ d, h }) => asCoverage(cells.status[d][h]));

  // compared days, one line each
  const compareCells = compare.metrics[metric];
  const compareOnlyToday = compare.days.length > 0 && compare.days.every((d) => d === today);
  const compareHours = compareOnlyToday ? compare.nowHour + 1 : 24;
  const compareSeries: ChartSeries[] = compare.days.map((day, d) => ({
    label: dayLabel(day),
    tone: ((d % 4) + 1) as ChartTone,
    values: compareCells.values[d].slice(0, compareHours),
  }));
  const compareCoverage = Array.from({ length: compareHours }, (_, h): Coverage => {
    const s = compare.days.map((_, d) => compareCells.status[d][h]).filter((x) => x !== "future");
    if (s.includes("partial")) return "partial";
    return s.some((x) => x === "full") ? "full" : "none";
  });

  const heatDays = range.days.slice(-HEATMAP_MAX_DAYS);
  const heatOffset = range.days.length - heatDays.length;

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="시간대 분석"
        description={
          <>
            <p>
              서비스 전체 이용량을 한국 시간 기준 날짜·시간(0~23시)별로 보여 줍니다. 축제·홍보 글·사건 전후처럼 특정 시점의 변화를 시간 단위로
              비교할 때 씁니다. 회원별 기록이 아닌 시간대별 합계만 사용하며, 관리자의 이용은 포함하지 않습니다.
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
                  <b className="font-semibold">시간대별 활성 회원</b>: 그 시간에 로그인 상태 활동이 한 번이라도 감지된 서로 다른 회원 수(사람 수, 시간대마다
                  따로 셈). 여러 시간·날짜를 더한 값은 사람 수가 아니라 &lsquo;회원·시간&rsquo; 수입니다.
                </li>
                <li>
                  <b className="font-semibold">로그인 완료</b>: Google 로그인을 새로 마친 횟수. 로그인은 최대 30일 유지되므로 이용량보다 훨씬 적습니다.
                </li>
                <li>
                  지표마다 수집 시작 시점이 다릅니다: {sinceLine}. 그 전은 <b className="font-semibold">미측정</b>(0이 아님)이고, 수집을 시작한 시간은
                  부분 측정입니다. 미측정 기간의 시간대별 수치는 추정·복원하지 않습니다.
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
        <nav className="flex flex-wrap gap-2" aria-label="분석 지표">
          {HOURLY_METRICS.map((x) => (
            <Link
              key={x.key}
              href={hrefWith({ m: x.key })}
              aria-current={x.key === metric ? "page" : undefined}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                x.key === metric ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {x.label}
            </Link>
          ))}
        </nav>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5 max-md:[&>*:last-child]:col-span-2">
          <StatTile
            label="페이지뷰(전체)"
            value={valueText(totalOf(m.pv).value, totalOf(m.pv).status, "회")}
            sub={
              <>
                회원 {valueText(pvMember.value, pvMember.status, "")} · 비로그인 {valueText(pvAnon.value, pvAnon.status, "")}
              </>
            }
          />
          <StatTile label="방문 세션(시작)" value={valueText(sessions.value, sessions.status, "회")} sub="방문 횟수, 사람 수 아님" />
          <StatTile
            label="활성 회원 최다 시간"
            value={busiestActive ? `${fmt(busiestActive.n)}명` : totalOf(m.active).status === "none" ? <Unmeasured /> : "0명"}
            sub={busiestActive ? `${dayLabel(range.days[busiestActive.d])} ${busiestActive.h}시` : "한 시간 안의 서로 다른 회원 수"}
          />
          <StatTile label="로그인 완료" value={valueText(logins.value, logins.status, "회")} sub="Google 로그인을 새로 마친 수" />
          <StatTile
            label={`${info.short} 최다 시간대`}
            value={peak ? `${peak.hour}시` : profile.status.every((s) => s === "none" || s === "future") ? <Unmeasured /> : "-"}
            sub={peak ? `기간 합계 ${fmt(peak.n)}${info.unit} (0~23시 중)` : "기록 없음"}
          />
        </div>
      </Section>

      <Section title="시간대별 합계 (0~23시)" description="선택한 기간의 각 날짜를 같은 시간끼리 더한 값입니다. 하루 중 언제 많이 이용하는지 봅니다.">
        <div className="grid gap-5 md:grid-cols-2">
          {(() => {
            const member = hourSeries(m.pvMember, "로그인 회원", 1, undefined, hours);
            const anon = hourSeries(m.pvAnon, "비로그인", 2, undefined, hours);
            const all = byHour(m.pv);
            return (
              <StackedBarChart
                title="페이지뷰 (로그인 회원 + 비로그인)"
                unit="회"
                labels={hourLabels}
                tickEvery={3}
                series={[member, anon]}
                coverage={all.status.slice(0, hours).map(asCoverage)}
                inProgress={onlyToday}
              />
            );
          })()}
          {(() => {
            const s = hourSeries(m.session, "방문 세션", 1, undefined, hours);
            return <GroupedBarChart title="방문 세션 시작" unit="회" labels={hourLabels} tickEvery={3} series={[s]} coverage={s.coverage} inProgress={onlyToday} />;
          })()}
          {(() => {
            const s = hourSeries(m.active, "활성 회원", 1, undefined, hours);
            return (
              <GroupedBarChart
                title={range.days.length > 1 ? "시간대별 활성 회원 (날짜별 수의 합)" : "시간대별 활성 회원"}
                unit="명"
                labels={hourLabels}
                tickEvery={3}
                series={[s]}
                coverage={s.coverage}
                inProgress={onlyToday}
                note={range.days.length > 1 ? "여러 날을 더한 값이라 사람 수가 아닌 '회원·시간' 수입니다." : undefined}
              />
            );
          })()}
          {(() => {
            const s = hourSeries(m.login, "로그인 완료", 2, undefined, hours);
            return <GroupedBarChart title="로그인 완료" unit="회" labels={hourLabels} tickEvery={3} series={[s]} coverage={s.coverage} inProgress={onlyToday} />;
          })()}
        </div>
      </Section>

      <Section title="날짜·시간별 추이" description={`기간 안의 시간을 이어서 보여 줍니다(${info.label}). 홍보 글을 올린 뒤 몇 시부터 늘었는지 같은 변화를 봅니다.`}>
        {trendDays && trendPoints.length ? (
          <LineChart
            title={`${info.label} · 시간 단위`}
            unit={info.unit}
            labels={trendPoints.map(({ day, h }) => (trendDays.length === 1 ? `${h}시` : `${md(day)} ${h}시`))}
            tickEvery={trendDays.length === 1 ? 3 : trendDays.length <= 3 ? 6 : 24}
            series={trendSeries}
            coverage={trendCoverage}
            inProgress={trendDays.includes(today)}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            {TREND_MAX_DAYS}일 이하 기간에서 시간 단위로 이어서 보여 줍니다. 조회 기간의 &lsquo;사용자 지정&rsquo;으로 기간을 좁히거나, 아래 날짜 비교·히트맵을
            이용해 주세요.
          </p>
        )}
      </Section>

      <Section
        title="날짜별 시간대 비교"
        description={`고른 날짜(최대 ${MAX_COMPARE_DAYS}개)의 ${info.label}를 같은 시간축에 겹쳐 봅니다. 예: 축제 전날·당일·다음 날, 또는 홍보 글을 올린 날과 그 전 주 같은 요일.`}
      >
        <form action="/admin/stats" className="flex flex-wrap items-end gap-2 text-xs text-muted-foreground">
          {hiddenFields.map((f) => (
            <input key={`${f.name}=${f.value}`} type="hidden" name={f.name} value={f.value} />
          ))}
          {Array.from({ length: MAX_COMPARE_DAYS }, (_, i) => (
            <label key={i} className="flex flex-col gap-1">
              날짜 {i + 1}
              <input
                type="date"
                name="d"
                max={today}
                defaultValue={compareDays[i] ?? ""}
                className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
          ))}
          <button
            type="submit"
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
          >
            비교
          </button>
          <span className="basis-full">비워 둔 칸은 빼고 비교합니다. 날짜를 고르지 않으면 조회 기간의 마지막 3일을 보여 줍니다.</span>
        </form>
        {compare.days.length > 0 && (
          <>
            <LineChart
              title={`${info.label} · 날짜별 비교`}
              unit={info.unit}
              labels={HOUR_LABELS.slice(0, compareHours)}
              tickEvery={3}
              series={compareSeries}
              coverage={compareCoverage}
              note={compare.days.includes(today) ? `오늘(${md(today)})은 ${compare.nowHour}시까지의 값입니다.` : undefined}
            />
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
                  {compare.days.map((day, d) => {
                    const half = halves(compareCells, d);
                    const top = peakHour(compareCells.values[d]);
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
          </>
        )}
      </Section>

      <Section title="날짜 × 시간대 히트맵" description={`${info.label}를 날짜(행)와 시간(열)로 펼친 표입니다. 진할수록 많습니다.`}>
        <SubHeading basis={range.days.length > heatDays.length ? `기간이 길어 마지막 ${HEATMAP_MAX_DAYS}일만 표시` : `${heatDays.length}일`}>
          {heatDays.length ? `${heatDays[0]} ~ ${heatDays[heatDays.length - 1]}` : "표시할 날짜 없음"}
        </SubHeading>
        <HourHeatmap
          title={info.label}
          unit={info.unit}
          extraLabels={["오전", "오후", "합계"]}
          rows={heatDays.map((day, k) => {
            const d = heatOffset + k;
            const half = halves(cells, d);
            return {
              label: dayLabel(day),
              values: cells.values[d],
              status: cells.status[d],
              extras: [half.am, half.pm, half.day].map((x) => valueText(x.value, x.status, "")),
            };
          })}
          note={metric === "active" ? "칸마다 그 시간의 서로 다른 회원 수입니다. 오전·오후·합계는 시간별 수를 더한 '회원·시간' 수입니다." : undefined}
        />
      </Section>
    </div>
  );
}
