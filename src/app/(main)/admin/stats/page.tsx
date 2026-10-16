import Link from "next/link";

import { requireAdmin } from "@/lib/auth/session";
import { FREE_LIMITS_MB, METRICS, percentileMs, VISIT_SERIES, type Granularity, type TimingRow } from "@/lib/metrics/dashboard";
import { describeRoute, methodOf } from "@/lib/metrics/apiRoutes";
import { PERIOD_PRESETS, type PeriodPreset } from "@/lib/metrics/exportOptions";
import { kstDay } from "@/lib/metrics/record";
import {
  apiCoverage,
  bucketSpan,
  isInternalRoute,
  KEYWORD_BASIS_CHANGED_AT,
  loadReport,
  formatSeconds,
  meanDuration,
  medianBucket,
  resolvePeriod,
  testDataNotice,
  sinceLabel,
  summarizeTimings,
  unsplitSearches,
  type Coverage,
  type Report,
} from "@/lib/metrics/report";
import { DEVICE_KINDS, DEVICE_LABELS, PAGE_KIND_LABELS, REF_SOURCE_LABELS, type PageKind, type RefSource } from "@/lib/metrics/visits";
import { ApiStatsTable, type ApiStatRow } from "@/components/admin/ApiStatsTable";
import { BarList, GroupedBarChart, Meter, StackedBarChart } from "@/components/admin/StatsCharts";
import { More, Section, StatTile, Unmeasured } from "@/components/admin/StatsBlocks";
import { DURATION_BUCKETS, DURATION_LABELS, PAGES_BUCKETS, PAGES_LABELS } from "@/lib/metrics/flow";
import { StatsExportPanel } from "@/components/admin/StatsExportPanel";
import { StatsPeriodPicker } from "@/components/admin/StatsPeriodPicker";
import { UserStatsView } from "@/components/admin/UserStatsView";
import { loadUserReport } from "@/lib/metrics/userReport";
import { HourlyStatsView, type HourlyView } from "@/components/admin/HourlyStatsView";
import { HourlyDayPicker } from "@/components/admin/HourlyDayPicker";
import { HourlyExportButtons } from "@/components/admin/HourlyExportButtons";
import { isHourlyMetric, loadHourlyCells } from "@/lib/metrics/hourly";
import { describeDays, encodeDays, resolveSelection } from "@/lib/metrics/daySelection";
import { StatsOptOutToggle } from "@/components/admin/StatsOptOutToggle";
import { AlertIcon, ChevronRightIcon, InfoIcon } from "@/components/icons";

// 운영 통계 (admin only). Read-only aggregates: no search text, no member
// names -- 활성 회원 are counted from HMAC'd daily marks. Every number on
// this page comes from one loadReport() call, the same one the Excel/CSV
// export uses, so the screen and the files always agree.
const fmt = (n: number) => n.toLocaleString("ko-KR");
// A period's label from its first day inside the range (a week cut by the
// range starts there, not on the Monday before).
const bucketLabel = (start: string, unit: Granularity) => {
  const [, m, d] = start.split("-").map(Number);
  return unit === "month" ? `${start.slice(2, 4)}.${m}` : unit === "week" ? `${m}/${d}~` : `${m}/${d}`;
};
const UNIT_TEXT: Record<Granularity, string> = { day: "일별", week: "주별", month: "월별" };
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${h}시`);
const DOW_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const sum = (...values: (number | null)[]) => (values.every((v) => v === null) ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0));
const addSeries = (a: (number | null)[], b: (number | null)[]) => a.map((v, i) => sum(v, b[i]));

// A big number for the period, or 미측정 when the count hadn't begun.
function StatCard({
  label,
  value,
  coverage = "full",
  since,
  sub,
  values,
  display,
  primary,
}: {
  label: string;
  value: number | null;
  display?: string;
  coverage?: Coverage;
  since?: string;
  sub?: string;
  values?: (number | null)[];
  primary?: boolean;
}) {
  const note = [sub, coverage !== "full" && since ? `${since}부터 집계` : null].filter(Boolean).join(" · ");
  return (
    <StatTile
      label={label}
      primary={primary}
      value={display !== undefined ? display : value === null ? <Unmeasured /> : fmt(value)}
      sub={note || undefined}
      trend={values}
    />
  );
}

function InternalTimingTable({ rows }: { rows: TimingRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">이 기간에는 기록이 없습니다.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.route} className="flex flex-col gap-0.5 rounded-card border border-border p-3 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <p className="font-medium text-foreground">{describeRoute(r.route)}</p>
            <p className="font-mono text-[11px] text-muted-foreground">{r.route}</p>
          </div>
          <p className="shrink-0 tabular-nums text-muted-foreground">
            {fmt(r.count)}회 · 평균 <b className="font-semibold text-foreground">{fmt(r.avgMs)}ms</b> · p95 {r.p95}
            {r.errors > 0 && <span className="text-destructive"> · 실패 {fmt(r.errors)}</span>}
          </p>
        </li>
      ))}
    </ul>
  );
}

const Num = ({ v }: { v: number | null }) =>
  v === null ? <span className="text-muted-foreground/70">미측정</span> : v === 0 ? <span className="text-muted-foreground/60">0</span> : <>{fmt(v)}</>;

function SeriesTable({ report, columns }: { report: Report; columns: { label: string; values: (number | null)[] }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-right text-xs tabular-nums">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1.5 pr-2 text-left font-medium">기간</th>
            {columns.map((c) => (
              <th key={c.label} className="py-1.5 pr-2 font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.buckets
            .map((bucket, i) => ({ bucket, i }))
            .reverse()
            .map(({ bucket, i }) => (
              <tr key={bucket} className="border-t border-border">
                <td className="py-1.5 pr-2 text-left text-foreground">{bucketLabel(bucketSpan(report.range, bucket).from, report.range.unit)}</td>
                {columns.map((c) => (
                  <td key={c.label} className="py-1.5 pr-2">
                    <Num v={c.values[i]} />
                  </td>
                ))}
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
  searchParams: Promise<{ period?: string; from?: string; to?: string; tab?: string; m?: string; d?: string | string[] }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const today = kstDay();
  const preset = (PERIOD_PRESETS.some((p) => p.key === params.period) ? params.period : "month") as PeriodPreset;
  const asked = resolvePeriod({ preset, from: params.from, to: params.to }, today);
  // A bad custom range falls back to 이번 달, with the reason shown.
  const period = "error" in asked ? (resolvePeriod({ preset: "month" }, today) as Exclude<typeof asked, { error: string }>) : asked;
  const periodError = "error" in asked ? asked.error : null;
  const unit = period.range.unit;
  // (시간대 분석 is a section of 운영 통계; an old ?tab=hourly link opens 운영 통계)
  const tab: "ops" | "users" = params.tab === "users" ? "users" : "ops";
  // 시간대 분석: the calendar's days (`d`) and metric (`m`), kept across
  // period changes on 운영 통계
  const dParam = params.d === undefined ? null : [params.d].flat().join(",");
  const selection = resolveSelection(dParam, today);
  const selectedParam = encodeDays(selection.days);
  const metric: HourlyView = params.m === "all" ? "all" : isHourlyMetric(params.m) ? params.m : "pv";
  const hourlyQuery = new URLSearchParams({ d: selectedParam, m: metric }).toString();
  const periodQuery =
    period.selection.preset === "custom"
      ? `period=custom&from=${period.selection.from}&to=${period.selection.to}`
      : `period=${period.selection.preset}`;
  const tabClass = (active: boolean) =>
    `rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
      active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
    }`;

  const notice = testDataNotice();
  const header = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Link href="/admin" className="text-xs text-muted-foreground hover:text-foreground">
          ← 관리자
        </Link>
        <h1 className="text-xl font-semibold text-foreground">운영 통계</h1>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {period.label} · {UNIT_TEXT[unit]} 집계 · 한국 시간 기준(진행 중인 기간은 오늘 현재까지) · 개인정보와 검색어 원문은 수집하지 않습니다.
        </p>
      </div>
      {notice && (
        <p role="note" className="flex gap-2 rounded-card border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-foreground">
          <AlertIcon className="mt-0.5 size-4 shrink-0" />
          <span>{notice}</span>
        </p>
      )}
      <nav className="flex gap-1 border-b border-border" aria-label="통계 종류">
        <Link href={`/admin/stats?${periodQuery}`} aria-current={tab === "ops" ? "page" : undefined} className={tabClass(tab === "ops")}>
          운영 통계
        </Link>
        <Link href={`/admin/stats?tab=users&${periodQuery}`} aria-current={tab === "users" ? "page" : undefined} className={tabClass(tab === "users")}>
          사용자 통계
        </Link>
      </nav>
      <div className="flex flex-col gap-2">
        <StatsPeriodPicker
          active={period.selection.preset}
          from={period.selection.from ?? period.range.from}
          to={period.selection.to ?? today}
          today={today}
          openByDefault={period.selection.preset === "custom" || !!periodError}
          tab={tab}
          keep={tab === "ops" ? hourlyQuery : undefined}
        />
        {periodError && (
          <p role="alert" className="text-xs text-destructive">
            {periodError} 이번 달 기준으로 보여 줍니다.
          </p>
        )}
      </div>
      <details className="group rounded-card border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-card px-4 py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          운영·사용자 통계 내보내기 (Excel · CSV)
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        </summary>
        <div className="border-t border-border px-4 py-3">
          <StatsExportPanel
            preset={period.selection.preset}
            from={period.selection.from}
            to={period.selection.to}
            periodLabel={period.label}
            days={selectedParam}
            daysLabel={selection.days.length ? `${selection.days.length}일: ${describeDays(selection.days)}` : "고른 날짜 없음"}
          />
        </div>
      </details>
    </div>
  );

  if (tab === "users") {
    const users = await loadUserReport(period.range);
    return (
      <div className="flex flex-col gap-6">
        {header}
        <UserStatsView report={users} />
      </div>
    );
  }

  const [report, hourlyCells] = await Promise.all([loadReport(period.range), loadHourlyCells(selection.days)]);
  const hourlyHref = (m: HourlyView) => `/admin/stats?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(periodQuery)), d: selectedParam, m }).toString()}`;
  const { core, visit, totals, totalCoverage: cov } = report;
  const labels = report.buckets.map((b) => bucketLabel(bucketSpan(report.range, b).from, unit));
  const last = report.buckets.length - 1;
  const trend = report.buckets.length > 1;
  const pvAll = addSeries(visit.pvAnon, visit.pvMember);
  const sessionsAll = addSeries(visit.sessionAnon, visit.sessionMember);
  const searchAll = core.searchKeyword.map((v, i) => sum(v, core.searchSemantic[i], core.searchImage[i]));
  const sessionsTotal = sum(totals.sessionAnon, totals.sessionMember);
  const pvTotal = sum(totals.pvAnon, totals.pvMember) ?? 0;
  const flow = report.flow;
  const flowSessions = Object.values(flow.flowSessions).reduce((a, n) => a + n, 0);
  const everytime = cov.sessionAnon === "none" ? null : (report.breakdown.refs.find((r) => r.source === "everytime")?.sessions ?? 0);
  const hasUnmeasured = Object.values(report.totalCoverage).some((c) => c !== "full");
  const unsplit = unsplitSearches(report);
  const api = apiCoverage(report.range, today);
  const apiRows = report.timings.filter((r) => !isInternalRoute(r.route));
  const apiSummary = summarizeTimings(apiRows);
  const embed = summarizeTimings(report.timings.filter((r) => r.route.startsWith("ai:") && r.route.endsWith("-embed")));
  const ping = summarizeTimings(report.timings.filter((r) => r.route === "db:ping"));
  const apiTable: ApiStatRow[] = apiRows.map((r) => {
    const p95 = percentileMs(r.buckets ?? [], 0.95);
    return {
      route: r.route,
      method: methodOf(r.route),
      path: r.route.replace(/^[A-Z]+ /, ""),
      note: describeRoute(r.route),
      count: r.count,
      errors: r.errors,
      avgMs: r.avgMs,
      p50: r.p50,
      p95: r.p95,
      p95Ms: p95 === null ? null : Number.isFinite(p95) ? p95 : 1e9,
    };
  });
  const latest = trend ? `최근 ${labels[last]}: ` : null;
  // the last period runs to today, so its count is still growing
  const inProgress = report.range.until > report.today;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {header}
        {hasUnmeasured && (
          <p className="flex gap-2 rounded-card border border-border bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            <span>
              통계 수집을 시작하기 전 기간은 <b className="font-semibold text-foreground">미측정</b>으로 표시합니다(0건과 다름). 검색·활성 회원·응답 시간은{" "}
              {sinceLabel("ops")}부터, 방문 통계와 검색의 로그인 구분은 {sinceLabel("visit")}부터 집계됩니다. 활성 회원은 기록을 400일 보관하므로 그보다 오래된 날짜도
              미측정입니다.
            </span>
          </p>
        )}
      </div>

      {/* 핵심 지표 */}
      <section className="flex flex-col gap-2" aria-labelledby="stats-core">
        <h2 id="stats-core" className="text-base font-semibold text-foreground">
          핵심 지표 <span className="text-xs font-normal text-muted-foreground">표시 기간 합계</span>
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5 max-md:[&>*:last-child]:col-span-2">
          <StatCard primary label="신규 가입" value={totals.signups} sub={latest ? `${latest}${fmt(core.signups[last] ?? 0)}` : undefined} values={trend ? core.signups : undefined} />
          <StatCard
            primary
            label="활성 회원"
            value={totals.active}
            coverage={cov.active}
            since={sinceLabel("ops")}
            sub="기간 내 서로 다른 로그인 회원 · 탈퇴 시 그 회원 기록 삭제"
            values={trend ? core.active : undefined}
          />
          <StatCard primary label="방문 세션" value={sessionsTotal} coverage={cov.sessionAnon} since={sinceLabel("visit")} sub="고유 방문자 수 아님" values={trend ? sessionsAll : undefined} />
          <StatCard primary label="페이지뷰" value={sum(totals.pvAnon, totals.pvMember)} coverage={cov.pvAnon} since={sinceLabel("visit")} values={trend ? pvAll : undefined} />
          <StatCard
            primary
            label="검색 이용량"
            value={sum(totals.searchKeyword, totals.searchSemantic, totals.searchImage)}
            coverage={cov.searchKeyword}
            since={sinceLabel("ops")}
            sub="키워드·AI·이미지"
            values={trend ? searchAll : undefined}
          />
        </div>
      </section>

      <Section
        title="방문 분석"
        description={
          <>
            <p>
              사이트 화면이 열린 횟수(페이지뷰)와 방문 횟수(방문 세션)를 로그인 여부별로 보여 줍니다. 방문 세션은 사람 수가 아니라 방문
              횟수이며, 관리자의 방문은 포함되지 않습니다.
            </p>
            <More>
              <ul className="flex list-disc flex-col gap-1 pl-4">
                <li>
                  방문 세션은 <b className="font-semibold">첫 화면을 볼 때의 로그인 여부</b>로 나눕니다. 방문 도중 로그인하면 &lsquo;비로그인으로
                  시작&rsquo;한 방문으로 세고, 로그인한 뒤 본 화면은 &lsquo;로그인&rsquo; 페이지뷰로 셉니다. 그래서 로그인 페이지뷰가 있어도
                  &lsquo;로그인 상태로 시작&rsquo;한 방문은 0일 수 있습니다(예: 에브리타임 링크로 들어와 가입·로그인한 경우).
                </li>
                <li>
                  브라우저가 실제로 화면을 연 경우만 셉니다(링크 미리 불러오기·크롤러·자동화 브라우저 제외, 같은 화면 안의 필터·페이지 이동은
                  새 조회로 세지 않음).
                </li>
                <li>같은 브라우저에서 30분 넘게 조회가 없거나 날짜가 바뀌면 새 방문으로 셉니다. 한 사람이 기기 두 대로 들어오면 두 번 셉니다.</li>
                <li>
                  관리자 계정으로 로그인한 동안의 조회는 일반 통계에서 빼고 따로 셉니다. 관리자가 로그인한 적 있는 브라우저는 기본으로
                  &lsquo;내 방문 통계에서 제외&rsquo;가 켜져, 로그아웃한 뒤의 방문도 세지 않습니다.
                </li>
                <li>
                  IP·검색어·전체 URL·회원 정보는 저장하지 않고, 유입 경로는 정해진 분류로만, UTM은 영문·숫자 값만 셉니다. {sinceLabel("visit")}
                  부터 집계됩니다.
                </li>
              </ul>
            </More>
            <div className="mt-1.5">
              <StatsOptOutToggle />
            </div>
          </>
        }
      >
        {!trend && (
          <p className="rounded-card border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            하루만 고른 경우 추이 그래프 없이 합계만 보여 줍니다. 방문·검색 통계는 하루 단위로만 저장되어 시간별 그래프는 만들지 않습니다.
          </p>
        )}
        {trend && (
          <div className="grid gap-5 md:grid-cols-2">
            <StackedBarChart
              title="페이지뷰"
              unit="회"
              labels={labels}
              coverage={report.coverage.pvAnon}
              inProgress={inProgress}
              series={[
                { label: "로그인", values: visit.pvMember, tone: 1 },
                { label: "비로그인", values: visit.pvAnon, tone: 2 },
              ]}
            />
            <StackedBarChart
              title="방문 세션"
              unit="회"
              labels={labels}
              coverage={report.coverage.sessionAnon}
              inProgress={inProgress}
              series={[
                { label: "로그인 상태로 시작", values: visit.sessionMember, tone: 1 },
                { label: "비로그인으로 시작", values: visit.sessionAnon, tone: 2 },
              ]}
            />
          </div>
        )}
        <div className="grid gap-5 md:grid-cols-3">
          <div className="flex flex-col gap-1 rounded-card border border-primary/30 bg-primary-muted/40 p-3">
            <span className="text-xs text-muted-foreground">에브리타임 유입 (방문 세션)</span>
            {everytime === null ? (
              <span className="text-lg font-bold text-muted-foreground">미측정</span>
            ) : (
              <span className="text-xl font-bold tabular-nums text-foreground">{fmt(everytime)}</span>
            )}
            <span className="text-[11px] text-muted-foreground">
              {everytime !== null && sessionsTotal ? `전체 방문 세션의 ${Math.round((everytime / sessionsTotal) * 100)}%` : "에브리타임 게시글 링크로 시작한 방문"}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-foreground">유입 경로 (방문 세션, 비율은 전체 방문 세션 대비)</h3>
            <BarList
              rows={report.breakdown.refs.map((r) => ({ label: REF_SOURCE_LABELS[r.source as RefSource] ?? r.source, value: r.sessions }))}
              empty={cov.sessionAnon === "none" ? "미측정 기간입니다." : "아직 기록이 없습니다."}
            />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-foreground">UTM (홍보 링크 태그, 방문 세션)</h3>
            {report.breakdown.utmSources.length === 0 && report.breakdown.utmCampaigns.length === 0 ? (
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {cov.sessionAnon === "none"
                  ? "미측정 기간입니다."
                  : "아직 기록이 없습니다. 홍보 링크에 ?utm_source=everytime&utm_campaign=launch 처럼 붙이면 캠페인별로 집계됩니다."}
              </p>
            ) : (
              (
                [
                  ["utm_source별 (어디서 왔나)", report.breakdown.utmSources, "utm_source가 붙은"],
                  ["utm_campaign별 (어떤 홍보였나)", report.breakdown.utmCampaigns, "utm_campaign이 붙은"],
                ] as const
              ).map(([title, list, base]) => {
                const tagged = list.reduce((a, r) => a + r.sessions, 0);
                return (
                  <div key={title} className="flex flex-col gap-1.5">
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">{title}</span> · 비율 분모: {base} 방문 세션 {fmt(tagged)}회
                      {sessionsTotal ? ` (전체 방문 세션 ${fmt(sessionsTotal)}회 중)` : ""}
                    </p>
                    <BarList rows={list.map((r) => ({ label: r.value, value: r.sessions }))} empty="이 태그가 붙은 방문이 없습니다." />
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-foreground">많이 본 화면 (페이지뷰, 비로그인+로그인)</h3>
          <BarList
            rows={report.breakdown.pages.slice(0, 8).map((p) => ({
              label: PAGE_KIND_LABELS[p.kind as PageKind] ?? p.kind,
              value: p.anon + p.member,
              note: `로그인 ${fmt(p.member)}`,
            }))}
            empty={cov.pvAnon === "none" ? "미측정 기간입니다." : "아직 기록이 없습니다."}
          />
        </div>
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-foreground">접속 기기</h3>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {report.device.since
                ? `기기별 통계는 ${report.device.since}부터 집계됩니다(첫날은 일부, 그 전은 미측정). `
                : "기기별 통계는 아직 수집된 기록이 없습니다. "}
              비율의 분모는 기기 집계가 있는 방문 세션·페이지뷰입니다.
            </p>
            <More label="기기 구분 기준">
              <ul className="flex list-disc flex-col gap-1 pl-4">
                <li>브라우저가 보내는 User-Agent와 모바일 여부 힌트(Client Hints)로 서버에서 기기 종류만 나누어 셉니다. 원본 값이나 기기 식별자는 저장하지 않습니다.</li>
                <li>iPad는 Mac과 같은 User-Agent를 보내므로, 터치 화면이 있는 Mac 환경을 태블릿으로 셉니다(Mac에는 터치 화면이 없음).</li>
                <li>Windows 터치 노트북·Surface, 모바일 브라우저의 &lsquo;데스크톱 사이트&rsquo; 모드는 PC와 구분할 수 없어 PC로 셉니다.</li>
                <li>Android는 User-Agent에 Mobile이 없으면 태블릿으로 셉니다. TV·게임기·알 수 없는 브라우저는 기타·미확인입니다.</li>
              </ul>
            </More>
          </div>
          {report.device.totalCoverage === "none" ? (
            <p className="text-xs text-muted-foreground">미측정 기간입니다.</p>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {trend && (
                <div className="md:col-span-2">
                  <StackedBarChart
                    title="기기별 방문 세션"
                    unit="회"
                    labels={labels}
                    coverage={report.device.coverage}
                    inProgress={inProgress}
                    series={DEVICE_KINDS.map((k, i) => ({ label: DEVICE_LABELS[k], values: report.device.session[k], tone: ([1, 2, 3, 4] as const)[i] }))}
                  />
                </div>
              )}
              {(
                [
                  ["방문 세션", report.device.totals.session],
                  ["페이지뷰", report.device.totals.pv],
                ] as const
              ).map(([title, totalsByKind]) => {
                const all = DEVICE_KINDS.reduce((a, k) => a + (totalsByKind[k] ?? 0), 0);
                return (
                  <div key={title} className="flex flex-col gap-2">
                    <p className="text-[11px] text-muted-foreground">
                      <span className="text-xs font-semibold text-foreground">기기별 {title}</span> · 분모: {fmt(all)}회
                    </p>
                    <BarList rows={DEVICE_KINDS.map((k) => ({ label: DEVICE_LABELS[k], value: totalsByKind[k] ?? 0 }))} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Section>

      <div id="hourly" className="scroll-mt-20">
        <HourlyStatsView
          cells={hourlyCells}
          metric={metric}
          hrefWith={hourlyHref}
          today={today}
          notice={selection.notice}
          picker={<HourlyDayPicker selected={selection.days} today={today} />}
          actions={<HourlyExportButtons preset={period.selection.preset} from={period.selection.from} to={period.selection.to} days={selectedParam} />}
        />
      </div>

      <Section
        title="방문 시간·이탈 분석"
        description={
          <>
            <p>
              방문이 언제 시작돼 얼마나 이어졌고 어느 화면에서 끝났는지의 익명 합계입니다. 체류 시간과 이탈은{" "}
              <b className="font-semibold text-foreground">추정치</b>입니다(마지막으로 확인된 활동 기준).
            </p>
            <More>
              <ul className="flex list-disc flex-col gap-1 pl-4">
                <li>방문 시작은 기존 방문 세션 기준(30분 넘게 조회가 없거나 날짜가 바뀌면 새 방문)이며, 화면 이동·새로고침은 새 방문이 아닙니다.</li>
                <li>
                  체류 시간은 방문의 첫 화면부터 마지막으로 확인된 활동(화면 조회, 또는 화면이 보이는 동안의 터치·클릭·스크롤·키 입력)까지입니다. 탭이
                  백그라운드에 있거나 아무 입력이 없으면 늘지 않고, 브라우저를 닫은 정확한 시각은 알 수 없습니다. 평균에는 한 방문당 최대 60분만 넣습니다.
                </li>
                <li>
                  마지막 화면은 방문이 끝난 것으로 추정되는 화면, 종료 시간대는 마지막 활동 시각입니다. 오늘 수치에는 아직 진행 중인 방문이 그 순간까지의
                  상태로 포함됩니다.
                </li>
                <li>
                  마지막 이용 화면 비중 = 그 화면에서 끝난 방문 ÷ 체류·이탈 집계 방문(같은 방문들 안의 비율). 한 화면만 보고 끝난 방문 비율 = 화면을
                  1개만 본 방문 ÷ 체류·이탈 집계 방문. 함께 표시한 조회 수는 같은 기간 그 화면이 열린 횟수(원시 집계)로, 방문 수와 단위가 달라 비율로
                  나누지 않습니다.
                </li>
                <li>
                  브라우저가 마지막 활동을 보내기 전에 닫히면 다음 방문 때(7일 이내) 보내며, 끝내 오지 않으면 그 전까지 확인된 활동까지만 반영됩니다.
                  개인별 이동 기록이나 정확한 접속·종료 시각은 저장하지 않습니다.
                </li>
                <li>
                  방문 시작(시간대·요일·첫 화면)은 {flow.startSince ?? "-"}부터, 체류·이탈은 {flow.since ?? "-"}부터 집계되며 그 전은 미측정입니다. 세션은
                  날짜가 바뀌면 끝나므로 요일별 이탈은 시작한 날의 요일로 셉니다.
                </li>
              </ul>
            </More>
          </>
        }
      >
        {flow.startCoverage === "none" && flow.coverage === "none" ? (
          <p className="text-xs text-muted-foreground">미측정 기간입니다.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5 max-md:[&>*:last-child]:col-span-2">
              <StatCard label="평균 체류 시간 (추정)" value={null} display={formatSeconds(meanDuration(flow))} sub={`체류 집계 방문 ${fmt(flowSessions)}회`} />
              <StatCard
                label="체류 시간 중앙값 (구간)"
                value={null}
                display={medianBucket(flow.duration) ? DURATION_LABELS[medianBucket(flow.duration)!] : "-"}
                sub="정확한 중앙값 대신 구간"
              />
              <StatCard
                label="한 화면만 보고 끝난 방문"
                value={null}
                display={flowSessions ? `${Math.round((flow.pages["1"] / flowSessions) * 100)}%` : "-"}
                sub={`${fmt(flow.pages["1"])}회 / 체류·이탈 집계 방문 ${fmt(flowSessions)}회`}
              />
              <StatCard
                label="방문당 평균 페이지뷰"
                value={null}
                display={sessionsTotal ? (pvTotal / sessionsTotal).toFixed(1) : "-"}
                sub="페이지뷰 ÷ 방문 세션"
              />
              <StatCard
                label="종료 미확인 방문"
                value={flow.coverage === "none" ? null : flow.open}
                sub={`다시 오지 않아 끝을 확인 못 함 · 종료 확인 ${fmt(flow.closed)}회`}
              />
            </div>
            {flow.issues.length > 0 && (
              <div role="alert" className="flex gap-2 rounded-card border border-warning/50 bg-warning-muted px-3 py-2 text-[11px] leading-relaxed text-foreground">
                <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                <div>
                  <p className="font-semibold">데이터 불일치 발견 — 아래 분포는 보정 없이 그대로 믿기 어렵습니다.</p>
                  <ul className="mt-1 list-disc pl-4">
                    {flow.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-muted-foreground">보고 누락·중복(정확한 1회 처리를 보장하지 않음)으로 생길 수 있으며, 원시 값은 Excel/CSV에 그대로 있습니다.</p>
                </div>
              </div>
            )}
            <p className="rounded-card border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              <b className="font-semibold text-foreground">종료 확인</b>: 같은 브라우저가 나중에 다시 방문해서, 앞의 방문이 끝났다는 것이 확인된 방문.{" "}
              <b className="font-semibold text-foreground">종료 미확인</b>: 그 뒤 다시 오지 않아 끝난 시점을 확인할 수 없는 방문으로, 대부분은 이미
              떠난 방문입니다. &lsquo;지금 이용 중&rsquo;이라는 뜻이 아니며, 오늘 방문 중 일부만 실제로 이용 중일 수 있습니다. 두 경우 모두 체류
              시간·마지막 화면은 마지막으로 확인된 활동 기준입니다.
            </p>
            <div className="grid gap-5 md:grid-cols-2">
              <GroupedBarChart
                title="시간대별 방문 시작·추정 종료 (KST)"
                unit="회"
                labels={HOUR_LABELS}
                tickEvery={3}
                series={[
                  { label: "방문 시작", values: flow.startHour, tone: 1 },
                  { label: "추정 종료(마지막 활동)", values: flow.endHour, tone: 2 },
                ]}
              />
              <GroupedBarChart
                title="요일별 방문 시작·추정 종료"
                unit="회"
                labels={DOW_LABELS}
                series={[
                  { label: "방문 시작", values: flow.startDow, tone: 1 },
                  { label: "추정 종료", values: flow.endDow, tone: 2 },
                ]}
              />
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-muted-foreground">
                  <span className="text-xs font-semibold text-foreground">체류 시간 (추정)</span> · 분모: 체류 집계 방문 {fmt(flowSessions)}회
                </p>
                <BarList rows={DURATION_BUCKETS.map((b) => ({ label: DURATION_LABELS[b], value: flow.duration[b] }))} />
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-muted-foreground">
                  <span className="text-xs font-semibold text-foreground">첫 화면 (방문 시작)</span> · 분모: 방문 시작{" "}
                  {fmt(Object.values(flow.firstPage).reduce((a, v) => a + (v ?? 0), 0))}회
                </p>
                <BarList
                  total={Object.values(flow.firstPage).reduce<number>((a, v) => a + (v ?? 0), 0)}
                  rows={Object.entries(flow.firstPage)
                    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                    .slice(0, 8)
                    .map(([kind, n]) => ({ label: PAGE_KIND_LABELS[kind as PageKind] ?? kind, value: n ?? 0 }))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-muted-foreground">
                  <span className="text-xs font-semibold text-foreground">마지막 이용 화면 (추정)</span> · 비중 = 그 화면에서 끝난 방문 ÷ 체류·이탈 집계
                  방문 {fmt(flowSessions)}회
                </p>
                <BarList
                  total={flowSessions}
                  rows={Object.entries(flow.exitPage)
                    .filter(([, n]) => (n ?? 0) > 0)
                    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                    .slice(0, 8)
                    .map(([kind, n]) => {
                      const pv = flow.pageViewsSinceFlow[kind as PageKind] ?? 0;
                      return { label: PAGE_KIND_LABELS[kind as PageKind] ?? kind, value: n ?? 0, note: `조회 ${fmt(pv)}회` };
                    })}
                />
              </div>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold text-foreground">첫 화면 → 마지막 화면 (상위 8개)</h3>
                <BarList
                  rows={flow.paths.slice(0, 8).map((p) => ({
                    label: p.first === p.last ? `${PAGE_KIND_LABELS[p.first]} (이동 없이 이 화면)` : `${PAGE_KIND_LABELS[p.first]} → ${PAGE_KIND_LABELS[p.last]}`,
                    value: p.sessions,
                  }))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold text-foreground">기기별 체류 시간 (추정)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[320px] text-right text-xs tabular-nums">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-2 text-left font-medium">기기</th>
                        <th className="py-1 pr-2 font-medium">방문</th>
                        <th className="py-1 pr-2 font-medium">평균 체류</th>
                        <th className="py-1 font-medium">10초 미만</th>
                      </tr>
                    </thead>
                    <tbody>
                      {DEVICE_KINDS.map((d) => (
                        <tr key={d} className="border-t border-border text-foreground">
                          <td className="py-1 pr-2 text-left">{DEVICE_LABELS[d]}</td>
                          <td className="py-1 pr-2">{fmt(flow.flowSessions[d])}</td>
                          <td className="py-1 pr-2">{formatSeconds(meanDuration(flow, d))}</td>
                          <td className="py-1">
                            {flow.flowSessions[d] ? `${Math.round((flow.durationByDevice[d].lt10s / flow.flowSessions[d]) * 100)}%` : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <More label="방문당 화면 수·기기별 이탈 화면 보기">
              <div className="grid gap-5 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold text-foreground">방문당 본 화면 수</h3>
                  <BarList rows={PAGES_BUCKETS.map((b) => ({ label: PAGES_LABELS[b], value: flow.pages[b] }))} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[360px] text-right text-xs tabular-nums">
                    <thead>
                      <tr>
                        <th className="py-1 pr-2 text-left font-medium">마지막 화면</th>
                        {DEVICE_KINDS.map((d) => (
                          <th key={d} className="py-1 pr-2 font-medium">
                            {DEVICE_LABELS[d]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.keys(flow.exitPage)
                        .filter((k) => (flow.exitPage[k as PageKind] ?? 0) > 0)
                        .map((k) => (
                          <tr key={k} className="border-t border-border text-foreground">
                            <td className="py-1 pr-2 text-left">{PAGE_KIND_LABELS[k as PageKind] ?? k}</td>
                            {DEVICE_KINDS.map((d) => (
                              <td key={d} className="py-1 pr-2">
                                {fmt(flow.exitByDevice[d][k as PageKind] ?? 0)}
                              </td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </More>
          </>
        )}
      </Section>

      <Section title="서비스 이용" description="게시글 등록·검색·AI 추천·채팅·완료 처리의 표시 기간 합계입니다.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCard label="분실물 등록" value={totals.lost} />
          <StatCard label="습득물 등록" value={totals.found} />
          <StatCard label="AI 추천 노출" value={totals.recommend} coverage={cov.recommend} since={sinceLabel("ops")} />
          <StatCard label="신규 채팅방" value={totals.chatRooms} />
          <StatCard label="채팅 메시지" value={totals.messages} />
          <StatCard label="완료 처리" value={totals.completed} coverage={cov.completed} since={sinceLabel("completed")} sub="작성자 표시 기준" />
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {trend && (
            <StackedBarChart
              title="게시글 등록"
              unit="건"
              labels={labels}
              coverage={report.coverage.lost}
              inProgress={inProgress}
              series={[
                { label: "분실물", values: core.lost, tone: 1 },
                { label: "습득물", values: core.found, tone: 2 },
              ]}
            />
          )}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold text-foreground">검색 유형</h3>
            {cov.searchKeyword === "none" ? (
              <p className="text-xs text-muted-foreground">미측정 기간입니다.</p>
            ) : (
              <BarList
                rows={[
                  { label: "키워드 검색", value: totals.searchKeyword ?? 0 },
                  { label: "자연어(AI) 검색", value: totals.searchSemantic ?? 0 },
                  { label: "이미지 검색", value: totals.searchImage ?? 0 },
                ]}
              />
            )}
            <h3 className="text-xs font-semibold text-foreground">검색한 사람의 로그인 여부</h3>
            {cov.searchAnon === "none" ? (
              <p className="text-xs text-muted-foreground">미측정 기간입니다({sinceLabel("visit")}부터 집계).</p>
            ) : (
              <BarList
                rows={[
                  { label: "비로그인", value: totals.searchAnon ?? 0 },
                  { label: "로그인", value: totals.searchMember ?? 0 },
                  ...(unsplit ? [{ label: `구분 집계 전(${sinceLabel("visit")} 이전)`, value: unsplit }] : []),
                ]}
              />
            )}
          </div>
        </div>
        <More label="집계 기준">
          <ul className="flex list-disc flex-col gap-1 pl-4">
            <li>검색은 첫 페이지 결과를 볼 때 한 번 세며, 같은 서버에서 10초 안에 반복된 같은 검색은 한 번으로 셉니다.</li>
            <li>
              키워드 검색은 {KEYWORD_BASIS_CHANGED_AT.replace("T", " ")}부터 게시판·검색 화면의 검색도 셉니다(이전: API 검색만). 이 시점 전후를
              직접 비교하지 마세요.
            </li>
            <li>
              검색의 로그인·비로그인 구분은 {sinceLabel("visit")}부터 집계되어, 그 전 검색은 합계에만 포함됩니다. 관리자 검색은 어느 쪽에도 넣지
              않습니다.
            </li>
            <li>
              완료 처리는 작성자가 게시글을 &lsquo;찾음/완료&rsquo;로 바꾸고 되돌리지 않은 건수(작성자 표시)이며, 실제 물품 반환을 확인한 수치가
              아닙니다. 상태 변경 이력은 {sinceLabel("completed")}부터 있습니다.
            </li>
          </ul>
        </More>
      </Section>

      <Section
        title="서버 상태"
        description={
          <>
            <p>조회 기간의 API 응답 시간·오류율과 AI 추론·DB 지연, 현재 저장 용량입니다.</p>
            {api.note && <p className="mt-1 text-warning">{api.note}</p>}
          </>
        }
      >
        {api.coverage === "none" ? (
          <p className="text-xs text-muted-foreground">이 기간은 미측정입니다.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <StatCard label="API 요청" value={apiSummary.count} />
            <StatCard
              label="오류율 (5xx)"
              value={null}
              display={apiSummary.errorRate === null ? "-" : `${(apiSummary.errorRate * 100).toFixed(1)}%`}
              sub={`오류 ${fmt(apiSummary.errors)}건`}
            />
            <StatCard label="평균 응답" value={null} display={apiSummary.avgMs === null ? "-" : `${fmt(apiSummary.avgMs)}ms`} />
            <StatCard label="p95 응답" value={null} display={apiSummary.p95} sub="구간 상한값" />
            <StatCard label="AI 추론 평균" value={null} display={embed.avgMs === null ? "-" : `${fmt(embed.avgMs)}ms`} sub={`${fmt(embed.count)}건 · 모델 로딩 제외`} />
            <StatCard label="DB 왕복 평균" value={null} display={ping.avgMs === null ? "-" : `${fmt(ping.avgMs)}ms`} />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {report.capacity ? (
            <>
              <Meter label="데이터베이스 (Supabase Free)" used={report.capacity.dbMb} limit={FREE_LIMITS_MB.db} unit="MB" />
              <Meter label="Storage 사진 (Supabase Free)" used={report.capacity.storageMb} limit={FREE_LIMITS_MB.storage} unit="MB" />
              <p className="text-[11px] text-muted-foreground sm:col-span-2">
                {report.capacity.day} 기준(매일 새벽 정리 작업 때 기록, 조회 기간과 관계없음). 60%부터 주의, 80%부터 정리나 요금제 검토가 필요합니다.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">아직 기록이 없습니다(매일 새벽 정리 작업 때 기록).</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">API 응답 시간·오류율</h3>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            시간 단위로 저장된 기록을 조회 기간(KST)만큼 합산합니다(최근 90일 보관). 서버 인스턴스마다 모아 기록하므로 인스턴스 종료 직전 값은 빠질 수
            있습니다. p50/p95는 구간 상한값, 오류율은 5xx 응답 비율이며, 비고는 각 API 코드에서 확인한 역할입니다.
          </p>
          <ApiStatsTable rows={apiTable} empty={api.coverage === "none" ? "이 기간은 미측정입니다." : "이 기간에는 기록이 없습니다."} />
        </div>
        <More label="AI 추론·DB 지연 보기">
          <InternalTimingTable rows={report.timings.filter((r) => isInternalRoute(r.route))} />
        </More>
      </Section>

      <Section title="상세 데이터" description="기간별 수치 표입니다. 그래프와 같은 값이며, 내보내기 파일에도 같은 값이 들어갑니다.">
        <More label="기간별 서비스 이용 표 펼치기">
          <SeriesTable report={report} columns={METRICS.map((m) => ({ label: m.label, values: core[m.key] }))} />
        </More>
        <More label="기간별 방문 통계 표 펼치기">
          <SeriesTable
            report={report}
            columns={[
              ...VISIT_SERIES.map((s) => ({ label: s.label, values: visit[s.key] })),
              { label: "페이지뷰 합계", values: pvAll },
              { label: "방문 세션 합계", values: sessionsAll },
            ]}
          />
        </More>
        <More label="화면별 페이지뷰 표 펼치기">
          {report.breakdown.pages.length === 0 ? (
            <p>{cov.pvAnon === "none" ? "미측정 기간입니다." : "아직 기록이 없습니다."}</p>
          ) : (
            <table className="w-full max-w-md text-right text-xs tabular-nums">
              <thead>
                <tr>
                  <th className="py-1 pr-2 text-left font-medium">화면</th>
                  <th className="py-1 pr-2 font-medium">비로그인</th>
                  <th className="py-1 font-medium">로그인</th>
                </tr>
              </thead>
              <tbody>
                {report.breakdown.pages.map((p) => (
                  <tr key={p.kind} className="border-t border-border text-foreground">
                    <td className="py-1 pr-2 text-left">{PAGE_KIND_LABELS[p.kind as PageKind] ?? p.kind}</td>
                    <td className="py-1 pr-2">{fmt(p.anon)}</td>
                    <td className="py-1">{fmt(p.member)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </More>
      </Section>
    </div>
  );
}
