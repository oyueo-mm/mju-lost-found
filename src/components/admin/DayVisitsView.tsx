import type { ReactNode } from "react";

import { LineChart, StackedBarChart, type ChartSeries } from "@/components/admin/StatsCharts";
import { More, Section, StatTile, SubHeading, Unmeasured } from "@/components/admin/StatsBlocks";
import { VisitDayPicker } from "@/components/admin/VisitDayPicker";
import { changeOf, type CompareRow, type DayVisitReport, type MultiDayReport } from "@/lib/metrics/dayVisits";
import { peakHour, type CellStatus } from "@/lib/metrics/hourly";
import type { Coverage } from "@/lib/metrics/report";

// 날짜별 방문 분석 (a section of 운영 통계): one KST day of visitors' use --
// visitors, sessions and page views split by login state, its 0-23시 and
// the change from the day before. Server only; every number comes from
// lib/metrics/dayVisits.ts, the same report the export writes.

const fmt = (n: number) => n.toLocaleString("ko-KR");
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}(${DOW[new Date(`${day}T00:00:00Z`).getUTCDay()]})`;
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${h}시`);
const SUB_ROWS = new Set(["sessionMember", "sessionAnon", "pvMember", "pvAnon"]);
const asCoverage = (s: CellStatus): Coverage => (s === "future" ? "full" : s);
const sum = (...v: (number | null)[]) => (v.every((x) => x === null) ? null : v.reduce<number>((a, x) => a + (x ?? 0), 0));

function Value({ v, unit, partial = false }: { v: number | null; unit: string; partial?: boolean }) {
  if (v === null) return <span className="font-normal text-muted-foreground/70">미측정</span>;
  return (
    <>
      {fmt(v)}
      {unit}
      {partial && <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">(부분)</span>}
    </>
  );
}

// "+12 (+15%)" from the previous day; from 0 only the difference.
export function ChangeText({ current, previous, unit }: { current: number | null; previous: number | null; unit: string }) {
  const { diff, rate } = changeOf(current, previous);
  if (diff === null) return <span className="text-muted-foreground">비교 불가</span>;
  if (diff === 0) return <span className="text-muted-foreground">변화 없음</span>;
  const tone = diff > 0 ? "text-success" : "text-destructive";
  const sign = diff > 0 ? "+" : "−";
  return (
    <span className={tone}>
      {diff > 0 ? "▲" : "▼"} {sign}
      {fmt(Math.abs(diff))}
      {unit}
      {rate !== null ? ` (${sign}${Math.abs(Math.round(rate * 1000) / 10)}%)` : " (이전 0)"}
    </span>
  );
}

function rowOf(report: DayVisitReport, key: CompareRow["key"]) {
  return report.rows.find((r) => r.key === key)!;
}

function Tile({ report, keyName, label, sub }: { report: DayVisitReport; keyName: CompareRow["key"]; label: string; sub?: ReactNode }) {
  const r = rowOf(report, keyName);
  // the tile's figure is always the whole selected day (today: so far)
  const whole: Record<string, number | null> = {
    members: report.current.members,
    session: sum(report.current.sessionMember, report.current.sessionAnon),
    pv: sum(report.current.pvMember, report.current.pvAnon),
  };
  const partial = keyName === "members" ? report.current.membersCoverage === "partial" : report.current.visitCoverage === "partial";
  const value = whole[keyName];
  return (
    <StatTile
      primary
      label={label}
      value={value === null ? <Unmeasured /> : <Value v={value} unit={r.unit} partial={partial} />}
      sub={
        <>
          {sub && <span className="block">{sub}</span>}
          {r.note ? (
            <span className="block">{r.note}</span>
          ) : (
            <span className="block">
              {report.basis === "hours" ? `어제 같은 시간(0~${report.hours - 1}시) 대비 ` : `${dayLabel(report.previous)} 대비 `}
              <ChangeText current={r.current} previous={r.previous} unit={r.unit} />
            </span>
          )}
        </>
      }
    />
  );
}

export function DayVisitsView({ report }: { report: DayVisitReport }) {
  const { current, before, hourly } = report;
  const hours = report.isToday ? report.nowHour + 1 : 24;
  const labels = HOUR_LABELS.slice(0, hours);
  const m = hourly.metrics;
  // hourly cells: row 0 = the day before, row 1 = the chosen day
  const series = (key: keyof typeof m, d: 0 | 1, label: string, tone: ChartSeries["tone"]) => ({
    label,
    tone,
    values: m[key].values[d].slice(0, hours),
    status: m[key].status[d].slice(0, hours),
  });
  const coverageOfDay = (key: keyof typeof m) => m[key].status[1].slice(0, hours).map(asCoverage);
  const peak = peakHour(m.pv.values[1]);
  const prevPeak = peakHour(m.pv.values[0]);
  const todayNote = report.isToday ? `오늘은 ${report.nowHour}시 현재까지의 값입니다(그 시간은 진행 중).` : undefined;
  const compareTitle = report.basis === "hours" ? `어제 같은 시간(0~${report.hours - 1}시)` : dayLabel(report.previous);
  const loginTable: { label: string; unit: string; member: number | null; anon: number | null; anonNote?: string; partial: boolean }[] = [
    { label: "방문자", unit: "명", member: current.members, anon: null, anonNote: "수집하지 않음", partial: current.membersCoverage === "partial" },
    { label: "방문 세션", unit: "회", member: current.sessionMember, anon: current.sessionAnon, partial: current.visitCoverage === "partial" },
    { label: "페이지뷰", unit: "회", member: current.pvMember, anon: current.pvAnon, partial: current.visitCoverage === "partial" },
  ];

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <VisitDayPicker day={report.day} today={report.today} />
        <p className="text-[11px] text-muted-foreground">
          {dayLabel(report.day)} · 비교: {compareTitle}
          {report.isToday ? ` · 오늘 ${report.nowHour}시 현재` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile report={report} keyName="members" label="방문자 (로그인 회원)" sub="비로그인 방문자 수는 수집하지 않음" />
        <Tile report={report} keyName="session" label="방문 세션" sub="방문 횟수, 사람 수 아님" />
        <Tile report={report} keyName="pv" label="페이지뷰" />
        <StatTile
          primary
          label="가장 많이 본 시간대"
          value={peak ? `${peak.hour}시` : "-"}
          sub={
            <>
              <span className="block">{peak ? `페이지뷰 ${fmt(peak.n)}회` : "측정된 시간에 기록 없음"}</span>
              <span className="block">
                {dayLabel(report.previous)}: {prevPeak ? `${prevPeak.hour}시 (${fmt(prevPeak.n)}회)` : "-"}
              </span>
            </>
          }
        />
      </div>

      <div className="flex flex-col gap-2">
        <SubHeading basis={`${dayLabel(report.day)} 하루${report.isToday ? "(진행 중)" : ""}`}>로그인·비로그인 비교</SubHeading>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[26rem] text-right text-xs tabular-nums">
            <caption className="sr-only">로그인·비로그인 이용자 비교</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-1.5 pr-2 text-left font-medium">지표</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">로그인</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">비로그인</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">합계</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">로그인 비중</th>
              </tr>
            </thead>
            <tbody>
              {loginTable.map((r) => {
                const total = r.anonNote ? null : sum(r.member, r.anon);
                return (
                  <tr key={r.label} className="border-t border-border text-foreground">
                    <th scope="row" className="py-1.5 pr-2 text-left font-medium">{r.label}</th>
                    <td className="py-1.5 pr-2"><Value v={r.member} unit={r.unit} partial={r.partial} /></td>
                    <td className="py-1.5 pr-2">{r.anonNote ? <span className="text-muted-foreground">{r.anonNote}</span> : <Value v={r.anon} unit={r.unit} />}</td>
                    <td className="py-1.5 pr-2 font-semibold">{r.anonNote ? "-" : <Value v={total} unit={r.unit} />}</td>
                    <td className="py-1.5 pr-2">{total && r.member !== null ? `${Math.round((r.member / total) * 100)}%` : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <StackedBarChart
          title={`시간대별 페이지뷰 · ${dayLabel(report.day)}`}
          unit="회"
          labels={labels}
          tickEvery={3}
          series={[
            { label: "로그인", values: m.pvMember.values[1].slice(0, hours), tone: 1 },
            { label: "비로그인", values: m.pvAnon.values[1].slice(0, hours), tone: 2 },
          ]}
          coverage={coverageOfDay("pv")}
          inProgress={report.isToday}
          note={todayNote}
        />
        <div className="grid gap-5 md:grid-cols-2">
          <LineChart
            title="페이지뷰 · 이전 날짜와 비교"
            unit="회"
            labels={labels}
            tickEvery={3}
            series={[series("pv", 1, dayLabel(report.day), 1), series("pv", 0, dayLabel(report.previous), 4)]}
            coverage={coverageOfDay("pv")}
          />
          <LineChart
            title="방문 세션(시작) · 이전 날짜와 비교"
            unit="회"
            labels={labels}
            tickEvery={3}
            series={[series("session", 1, dayLabel(report.day), 1), series("session", 0, dayLabel(report.previous), 4)]}
            coverage={coverageOfDay("session")}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SubHeading basis={report.basis === "hours" ? `오늘 0~${report.hours - 1}시와 어제 같은 시간` : `${dayLabel(report.day)}와 ${dayLabel(report.previous)}`}>
          이전 날짜와 비교
        </SubHeading>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[30rem] text-right text-xs tabular-nums">
            <caption className="sr-only">이전 날짜와 비교한 증감</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-1.5 pr-2 text-left font-medium">지표</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">{report.basis === "hours" ? "오늘" : dayLabel(report.day)}</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">{report.basis === "hours" ? "어제 같은 시간" : dayLabel(report.previous)}</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">증감 (증감률)</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.key} className="border-t border-border text-foreground">
                  <th scope="row" className={`py-1.5 pr-2 text-left font-medium ${SUB_ROWS.has(r.key) ? "pl-3 font-normal text-muted-foreground" : ""}`}>
                    {r.label}
                  </th>
                  {r.note ? (
                    <td colSpan={3} className="py-1.5 pr-2 text-muted-foreground">
                      {r.note}
                    </td>
                  ) : (
                    <>
                      <td className="py-1.5 pr-2"><Value v={r.current} unit={r.unit} /></td>
                      <td className="py-1.5 pr-2"><Value v={r.previous} unit={r.unit} /></td>
                      <td className="py-1.5 pr-2">
                        <ChangeText current={r.current} previous={r.previous} unit={r.unit} />
                        {r.partial && <span className="text-muted-foreground"> · 부분 측정 포함</span>}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <More label={`0~23시 표 (${dayLabel(report.day)})`}>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[34rem] text-right text-xs tabular-nums">
            <caption className="sr-only">시간대별 방문 표</caption>
            <thead>
              <tr>
                <th scope="col" className="py-1 pr-2 text-left font-medium">시간</th>
                <th scope="col" className="py-1 pr-2 font-medium">페이지뷰 로그인</th>
                <th scope="col" className="py-1 pr-2 font-medium">페이지뷰 비로그인</th>
                <th scope="col" className="py-1 pr-2 font-medium">방문 세션 시작</th>
                <th scope="col" className="py-1 pr-2 font-medium">활성 회원(그 시간)</th>
                <th scope="col" className="py-1 pr-2 font-medium">{dayLabel(report.previous)} 페이지뷰</th>
              </tr>
            </thead>
            <tbody>
              {labels.map((label, h) => (
                <tr key={label} className="border-t border-border text-foreground">
                  <th scope="row" className="py-1 pr-2 text-left font-medium">{label}</th>
                  {(
                    [
                      [m.pvMember, 1],
                      [m.pvAnon, 1],
                      [m.session, 1],
                      [m.active, 1],
                      [m.pv, 0],
                    ] as const
                  ).map(([cells, d], i) => (
                    <td key={i} className="py-1 pr-2">
                      {cells.status[d][h] === "future" ? "-" : <Value v={cells.values[d][h]} unit="" partial={cells.status[d][h] === "partial"} />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </More>

      {before.visitCoverage === "none" && current.visitCoverage !== "none" && (
        <p className="text-[11px] text-muted-foreground">{dayLabel(report.previous)}은 방문 통계 수집 전이라 비교하지 않습니다(미측정).</p>
      )}
    </>
  );
}

// ---------- the section around both views ----------

export function DayVisitsSection({ controls, children }: { controls: ReactNode; children: ReactNode }) {
  return (
    <Section
      title="날짜별 방문 분석"
      description={
        <>
          <p>
            고른 날짜의 일반 이용자 방문을 로그인 여부별로 봅니다(한국 시간 기준, 관리자 이용 제외). 하루를 고르면 0~23시와 전날 비교를, 여러 날을 고르면
            날짜별 비교·합계·평균을 보여 줍니다. 시간대 분석의 날짜 선택과는 따로 움직이며, 관리자 활동 탭의 날짜별 방문 기록(관리자 본인의 접속)과는 다른
            데이터입니다.
          </p>
          <More label="지표 정의와 한계">
            <ul className="flex list-disc flex-col gap-1 pl-4">
              <li>
                <b className="font-semibold">회원 방문자</b>: 그날 로그인 상태로 이용한 서로 다른 회원 수(관리자 계정 제외, 탈퇴한 회원의 기록은 삭제되어 빠짐).
                날짜마다 따로 센 사람 수라 여러 날을 더하지 않습니다. 여러 날 전체의 수는 그 기간에 한 번이라도 이용한 회원을 한 번씩만 따로 셉니다. 비로그인
                이용자는 개인을 식별하지 않으므로 <b className="font-semibold">방문자 수를 수집하지 않습니다</b>(방문 세션으로 추정하지 않음).
              </li>
              <li>
                <b className="font-semibold">방문 세션</b>: 방문 횟수(사람 수 아님). 첫 화면을 볼 때의 로그인 여부로 나누며, 30분 넘게 조회가 없거나 날짜가 바뀌면 새
                방문입니다. <b className="font-semibold">페이지뷰</b>: 화면이 열린 횟수(볼 때의 로그인 여부로 구분). 이 둘은 날짜별로 더할 수 있습니다.
              </li>
              <li>
                수집을 시작하기 전 날짜는 <b className="font-semibold">미측정</b>(0이 아님)이며 합계·평균에서 빼고, 수집을 시작한 날은 부분 측정입니다. 평균은
                측정된 날만으로 나눕니다.
              </li>
              <li>
                하루를 골랐을 때 시간대 그래프는 시간대 분석과 같은 시간별 기록입니다. 오늘을 고르면 어제의 같은 시간(0시부터 지금 시각 직전의 정시까지)과
                비교하며, 시간별로 저장하지 않는 값(로그인 구분 방문 세션, 회원 방문자)은 진행 중인 날에는 비교하지 않습니다.
              </li>
            </ul>
          </More>
        </>
      }
    >
      {controls}
      {children}
    </Section>
  );
}

// ---------- several days ----------

const statusText = (c: Coverage) => (c === "none" ? "미측정" : c === "partial" ? "부분 측정" : "측정");

export function MultiDayVisitsView({ report }: { report: MultiDayReport }) {
  const { figures, totals, members } = report;
  const n = figures.length;
  const labels = figures.map((f) => dayLabel(f.day));
  const visitCoverage = figures.map((f) => f.visitCoverage);
  const sessionTotal = sum(totals.sessionMember, totals.sessionAnon);
  const pvTotal = sum(totals.pvMember, totals.pvAnon);
  const avg = (v: number | null) => (v === null || report.measuredDays === 0 ? null : v / report.measuredDays);
  const one = (v: number | null, unit: string) => (v === null ? <Unmeasured /> : `${(Math.round(v * 10) / 10).toLocaleString("ko-KR")}${unit}`);
  const unmeasuredDays = n - report.measuredDays;
  return (
    <>
      <p className="text-[11px] text-muted-foreground">
        {n}일 선택 · 방문 통계 측정 {report.measuredDays}일{unmeasuredDays ? ` · 미측정 ${unmeasuredDays}일(합계·평균에서 제외)` : ""}
        {report.includesToday ? " · 오늘은 지금까지의 값" : ""}
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          primary
          label="방문 세션 합계"
          value={sessionTotal === null ? <Unmeasured /> : <Value v={sessionTotal} unit="회" />}
          sub={<>하루 평균 {one(avg(sessionTotal), "회")} · 사람 수 아님</>}
        />
        <StatTile primary label="페이지뷰 합계" value={pvTotal === null ? <Unmeasured /> : <Value v={pvTotal} unit="회" />} sub={<>하루 평균 {one(avg(pvTotal), "회")}</>} />
        <StatTile
          primary
          label="회원 방문자 (하루 평균)"
          value={one(members.average, "명")}
          sub={members.peak ? `가장 많은 날 ${dayLabel(members.peak.day)} ${fmt(members.peak.n)}명 · 날짜별 수는 더하지 않음` : "날짜별 수는 더하지 않음"}
        />
        <StatTile
          primary
          label="선택 기간 서로 다른 회원"
          value={members.distinct === null ? <Unmeasured text={report.memberDays === 0 ? "미측정" : "일부 미측정"} /> : <Value v={members.distinct} unit="명" partial={members.distinctPartial} />}
          sub="한 번이라도 이용한 회원을 한 번씩만 셈 · 비로그인은 수집하지 않음"
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <StackedBarChart
          title="날짜별 방문 세션"
          unit="회"
          labels={labels}
          coverage={visitCoverage}
          inProgress={report.includesToday && figures.at(-1)?.day === report.today}
          series={[
            { label: "로그인 상태로 시작", values: figures.map((f) => f.sessionMember), tone: 1 },
            { label: "비로그인으로 시작", values: figures.map((f) => f.sessionAnon), tone: 2 },
          ]}
        />
        <StackedBarChart
          title="날짜별 페이지뷰"
          unit="회"
          labels={labels}
          coverage={visitCoverage}
          inProgress={report.includesToday && figures.at(-1)?.day === report.today}
          series={[
            { label: "로그인", values: figures.map((f) => f.pvMember), tone: 1 },
            { label: "비로그인", values: figures.map((f) => f.pvAnon), tone: 2 },
          ]}
        />
        <LineChart
          title="날짜별 회원 방문자 (그날의 서로 다른 회원)"
          unit="명"
          labels={labels}
          coverage={figures.map((f) => f.membersCoverage)}
          series={[{ label: "회원 방문자", values: figures.map((f) => f.members), tone: 3, status: figures.map((f) => f.membersCoverage) }]}
          note="날짜가 띄엄띄엄 선택돼도 고른 날짜만 순서대로 잇습니다."
        />
      </div>

      <div className="flex flex-col gap-2">
        <SubHeading basis={`${n}일`}>날짜별 상세</SubHeading>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[44rem] text-right text-xs tabular-nums">
            <caption className="sr-only">고른 날짜별 방문 상세</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-1.5 pr-2 text-left font-medium">날짜</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">회원 방문자</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">세션 로그인</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">세션 비로그인</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">세션 합계</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">페이지뷰 로그인</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">페이지뷰 비로그인</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">페이지뷰 합계</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">측정</th>
              </tr>
            </thead>
            <tbody>
              {figures.map((f) => {
                const partial = f.visitCoverage === "partial";
                return (
                  <tr key={f.day} className="border-t border-border text-foreground">
                    <th scope="row" className="py-1.5 pr-2 text-left font-medium">
                      {f.day} ({DOW[new Date(`${f.day}T00:00:00Z`).getUTCDay()]})
                    </th>
                    <td className="py-1.5 pr-2"><Value v={f.members} unit="" partial={f.membersCoverage === "partial"} /></td>
                    <td className="py-1.5 pr-2"><Value v={f.sessionMember} unit="" partial={partial} /></td>
                    <td className="py-1.5 pr-2"><Value v={f.sessionAnon} unit="" partial={partial} /></td>
                    <td className="py-1.5 pr-2 font-semibold"><Value v={sum(f.sessionMember, f.sessionAnon)} unit="" /></td>
                    <td className="py-1.5 pr-2"><Value v={f.pvMember} unit="" partial={partial} /></td>
                    <td className="py-1.5 pr-2"><Value v={f.pvAnon} unit="" partial={partial} /></td>
                    <td className="py-1.5 pr-2 font-semibold"><Value v={sum(f.pvMember, f.pvAnon)} unit="" /></td>
                    <td className="py-1.5 pr-2 text-muted-foreground">{statusText(f.visitCoverage)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold text-foreground">
                <th scope="row" className="py-1.5 pr-2 text-left">합계 (측정된 {report.measuredDays}일)</th>
                <td className="py-1.5 pr-2 font-normal text-muted-foreground">더하지 않음</td>
                <td className="py-1.5 pr-2"><Value v={totals.sessionMember} unit="" /></td>
                <td className="py-1.5 pr-2"><Value v={totals.sessionAnon} unit="" /></td>
                <td className="py-1.5 pr-2"><Value v={sessionTotal} unit="" /></td>
                <td className="py-1.5 pr-2"><Value v={totals.pvMember} unit="" /></td>
                <td className="py-1.5 pr-2"><Value v={totals.pvAnon} unit="" /></td>
                <td className="py-1.5 pr-2"><Value v={pvTotal} unit="" /></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
}
