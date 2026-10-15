import Link from "next/link";
import type { ReactNode } from "react";

import { requireAdmin } from "@/lib/auth/session";
import { addPeriods, FREE_LIMITS_MB, loadTimings, METRICS, PERIODS, VISIT_SERIES, type Granularity, type TimingRow } from "@/lib/metrics/dashboard";
import { kstDay } from "@/lib/metrics/record";
import {
  dashboardRange,
  isInternalRoute,
  KEYWORD_BASIS_CHANGED_AT,
  loadReport,
  sinceLabel,
  SOURCE_OF,
  summarizeTimings,
  unsplitSearches,
  type Coverage,
  type Report,
} from "@/lib/metrics/report";
import { PAGE_KIND_LABELS, REF_SOURCE_LABELS, type PageKind, type RefSource } from "@/lib/metrics/visits";
import { BarList, Meter, Sparkline, StackedBarChart } from "@/components/admin/StatsCharts";
import { StatsExportPanel } from "@/components/admin/StatsExportPanel";
import { StatsOptOutToggle } from "@/components/admin/StatsOptOutToggle";
import { ChevronRightIcon, InfoIcon } from "@/components/icons";

// 운영 통계 (admin only). Read-only aggregates: no search text, no member
// names -- 활성 회원 are counted from HMAC'd daily marks. Every number on
// this page comes from one loadReport() call, the same one the Excel/CSV
// export uses, so the screen and the files always agree.
const UNITS: { unit: Granularity; label: string }[] = [
  { unit: "day", label: `일별 (${PERIODS.day}일)` },
  { unit: "week", label: `주별 (${PERIODS.week}주)` },
  { unit: "month", label: `월별 (${PERIODS.month}개월)` },
];
const WINDOWS = [7, 14, 30] as const;

const fmt = (n: number) => n.toLocaleString("ko-KR");
const bucketLabel = (bucket: string, unit: Granularity) => {
  const [, m, d] = bucket.split("-").map(Number);
  return unit === "month" ? `${bucket.slice(2, 4)}.${m}` : unit === "week" ? `${m}/${d}주` : `${m}/${d}`;
};
const sum = (...values: (number | null)[]) => (values.every((v) => v === null) ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0));
const addSeries = (a: (number | null)[], b: (number | null)[]) => a.map((v, i) => sum(v, b[i]));

function change(before: number | null, after: number | null): string {
  if (before === null || after === null) return "비교 불가";
  if (before === 0) return after === 0 ? "-" : "신규";
  const pct = Math.round(((after - before) / before) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description && <div className="text-xs leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      {children}
    </section>
  );
}

function More({ label = "자세히 보기", children }: { label?: string; children: ReactNode }) {
  return (
    <details className="group text-[11px] leading-relaxed text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-primary">
        {label}
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

// A big number for the period, or 미측정 when the count hadn't begun.
function StatCard({
  label,
  value,
  coverage = "full",
  since,
  sub,
  values,
  display,
}: {
  label: string;
  value: number | null;
  display?: string;
  coverage?: Coverage;
  since?: string;
  sub?: string;
  values?: (number | null)[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-card p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {display !== undefined ? (
        <span className="text-xl font-bold tabular-nums text-foreground">{display}</span>
      ) : value === null ? (
        <span className="text-lg font-bold text-muted-foreground">미측정</span>
      ) : (
        <span className="text-xl font-bold tabular-nums text-foreground">{fmt(value)}</span>
      )}
      {(sub || (coverage !== "full" && since)) && (
        <span className="text-[11px] leading-snug text-muted-foreground">
          {[sub, coverage !== "full" && since ? `${since}부터 집계` : null].filter(Boolean).join(" · ")}
        </span>
      )}
      {values && <Sparkline values={values} />}
    </div>
  );
}

function TimingTable({ rows }: { rows: TimingRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">아직 기록이 없습니다.</p>;
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
              <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(r.count)}</td>
              <td className={`py-1.5 pr-3 text-right tabular-nums ${r.errors > 0 ? "text-destructive" : ""}`}>
                {r.count ? `${((r.errors / r.count) * 100).toFixed(1)}%` : "-"}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(r.avgMs)}ms</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{r.p50}</td>
              <td className="py-1.5 text-right tabular-nums">{r.p95}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
                <td className="py-1.5 pr-2 text-left text-foreground">{bucketLabel(bucket, report.range.unit)}</td>
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
  searchParams: Promise<{ unit?: string; pivot?: string; window?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const unit: Granularity = params.unit === "week" || params.unit === "month" ? params.unit : "day";
  const pivot = /^\d{4}-\d{2}-\d{2}$/.test(params.pivot ?? "") && !Number.isNaN(Date.parse(params.pivot!)) ? params.pivot! : null;
  const windowDays = WINDOWS.includes(Number(params.window) as (typeof WINDOWS)[number]) ? Number(params.window) : 14;
  const today = kstDay();

  const [report, timings24h, timings7d, before, after] = await Promise.all([
    loadReport(dashboardRange(unit, today)),
    loadTimings(24),
    loadTimings(24 * 7),
    pivot ? loadReport({ from: addPeriods(pivot, "day", -windowDays), until: pivot, unit: "day" }, { withServer: false }) : null,
    pivot ? loadReport({ from: pivot, until: addPeriods(pivot, "day", windowDays), unit: "day" }, { withServer: false }) : null,
  ]);
  const { core, visit, totals, totalCoverage: cov } = report;
  const labels = report.buckets.map((b) => bucketLabel(b, unit));
  const last = report.buckets.length - 1;
  const latestLabel = labels[last];
  const pvAll = addSeries(visit.pvAnon, visit.pvMember);
  const sessionsAll = addSeries(visit.sessionAnon, visit.sessionMember);
  const searchAll = core.searchKeyword.map((v, i) => sum(v, core.searchSemantic[i], core.searchImage[i]));
  const sessionsTotal = sum(totals.sessionAnon, totals.sessionMember);
  const everytime = cov.sessionAnon === "none" ? null : (report.breakdown.refs.find((r) => r.source === "everytime")?.sessions ?? 0);
  const hasUnmeasured = Object.values(report.totalCoverage).some((c) => c !== "full");
  const api24 = summarizeTimings(timings24h.filter((r) => !isInternalRoute(r.route)));
  const embed7 = summarizeTimings(timings7d.filter((r) => r.route.startsWith("ai:") && r.route.endsWith("-embed")));
  const ping7 = summarizeTimings(timings7d.filter((r) => r.route === "db:ping"));
  const unsplit = unsplitSearches(report);
  const basisDay = KEYWORD_BASIS_CHANGED_AT.slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Link href="/admin" className="text-xs text-muted-foreground hover:text-foreground">
            ← 관리자
          </Link>
          <h1 className="text-xl font-semibold text-foreground">운영 통계</h1>
          <p className="text-xs leading-relaxed text-muted-foreground">
            한국 시간 기준 · 표시 기간 {report.range.from} ~ {addPeriods(report.range.until, "day", -1)} · 개인정보와 검색어 원문은 수집하지 않습니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
        <details className="group rounded-card border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-foreground">
            운영 통계 내보내기 (Excel · CSV)
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          </summary>
          <div className="border-t border-border px-4 py-3">
            <StatsExportPanel unit={unit} today={today} />
          </div>
        </details>
        {hasUnmeasured && (
          <p className="flex gap-2 rounded-card border border-border bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            <span>
              통계 수집을 시작하기 전 기간은 <b className="font-semibold text-foreground">미측정</b>으로 표시합니다(0건과 다름). 검색·활성 회원·응답 시간은{" "}
              {sinceLabel("ops")}부터, 방문 통계와 검색의 로그인 구분은 {sinceLabel("visit")}부터 집계됩니다.
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
          <StatCard label="신규 가입" value={totals.signups} sub={`최근 ${latestLabel}: ${fmt(core.signups[last] ?? 0)}`} values={core.signups} />
          <StatCard
            label="활성 회원"
            value={totals.active}
            coverage={cov.active}
            since={sinceLabel("ops")}
            sub="기간 내 서로 다른 로그인 회원"
            values={core.active}
          />
          <StatCard label="방문 세션" value={sessionsTotal} coverage={cov.sessionAnon} since={sinceLabel("visit")} sub="고유 방문자 수 아님" values={sessionsAll} />
          <StatCard label="페이지뷰" value={sum(totals.pvAnon, totals.pvMember)} coverage={cov.pvAnon} since={sinceLabel("visit")} values={pvAll} />
          <StatCard
            label="검색 이용량"
            value={sum(totals.searchKeyword, totals.searchSemantic, totals.searchImage)}
            coverage={cov.searchKeyword}
            since={sinceLabel("ops")}
            sub="키워드·AI·이미지"
            values={searchAll}
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
        <div className="grid gap-5 md:grid-cols-2">
          <StackedBarChart
            title="페이지뷰"
            labels={labels}
            series={[
              { label: "비로그인", values: visit.pvAnon, className: "fill-primary/35", swatch: "bg-primary/35" },
              { label: "로그인", values: visit.pvMember, className: "fill-primary", swatch: "bg-primary" },
            ]}
          />
          <StackedBarChart
            title="방문 세션"
            labels={labels}
            series={[
              { label: "비로그인으로 시작", values: visit.sessionAnon, className: "fill-primary/35", swatch: "bg-primary/35" },
              { label: "로그인 상태로 시작", values: visit.sessionMember, className: "fill-primary", swatch: "bg-primary" },
            ]}
          />
        </div>
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
            <h3 className="text-xs font-semibold text-foreground">유입 경로 (방문 세션)</h3>
            <BarList
              rows={report.breakdown.refs.map((r) => ({ label: REF_SOURCE_LABELS[r.source as RefSource] ?? r.source, value: r.sessions }))}
              empty={cov.sessionAnon === "none" ? "미측정 기간입니다." : "아직 기록이 없습니다."}
            />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-foreground">UTM 캠페인 (방문 세션)</h3>
            <BarList
              rows={[
                ...report.breakdown.utmCampaigns.map((r) => ({ label: `campaign: ${r.value}`, value: r.sessions })),
                ...report.breakdown.utmSources.map((r) => ({ label: `source: ${r.value}`, value: r.sessions })),
              ]}
              empty="아직 기록이 없습니다. 홍보 링크에 ?utm_source=everytime&utm_campaign=launch 처럼 붙이면 캠페인별로 집계됩니다."
            />
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
          <StackedBarChart
            title="게시글 등록"
            labels={labels}
            series={[
              { label: "분실물", values: core.lost, className: "fill-primary/35", swatch: "bg-primary/35" },
              { label: "습득물", values: core.found, className: "fill-primary", swatch: "bg-primary" },
            ]}
          />
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

      <Section title="서버 상태" description="API 응답 시간과 오류율(최근 24시간), AI 추론·DB 지연(최근 7일), 저장 용량입니다.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCard label="API 요청 (24시간)" value={api24.count} />
          <StatCard
            label="오류율 (5xx, 24시간)"
            value={null}
            display={api24.errorRate === null ? "-" : `${(api24.errorRate * 100).toFixed(1)}%`}
            sub={`오류 ${fmt(api24.errors)}건`}
          />
          <StatCard label="평균 응답 (24시간)" value={null} display={api24.avgMs === null ? "-" : `${fmt(api24.avgMs)}ms`} />
          <StatCard label="p95 응답 (24시간)" value={null} display={api24.p95} sub="구간 상한값" />
          <StatCard label="AI 추론 평균 (7일)" value={null} display={embed7.avgMs === null ? "-" : `${fmt(embed7.avgMs)}ms`} sub={`${fmt(embed7.count)}건 · 모델 로딩 제외`} />
          <StatCard label="DB 왕복 평균 (7일)" value={null} display={ping7.avgMs === null ? "-" : `${fmt(ping7.avgMs)}ms`} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {report.capacity ? (
            <>
              <Meter label="데이터베이스 (Supabase Free)" used={report.capacity.dbMb} limit={FREE_LIMITS_MB.db} unit="MB" />
              <Meter label="Storage 사진 (Supabase Free)" used={report.capacity.storageMb} limit={FREE_LIMITS_MB.storage} unit="MB" />
              <p className="text-[11px] text-muted-foreground sm:col-span-2">
                {report.capacity.day} 기준(매일 새벽 정리 작업 때 기록). 60%부터 주의, 80%부터 정리나 요금제 검토가 필요합니다.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">아직 기록이 없습니다(매일 새벽 정리 작업 때 기록).</p>
          )}
        </div>
        <More label="경로별 응답 시간 보기">
          <div className="flex flex-col gap-3">
            <p>서버 인스턴스마다 모아 기록합니다(인스턴스 종료 직전 값은 빠질 수 있음). p50/p95는 구간 상한값, 오류율은 5xx 응답 비율입니다.</p>
            <h3 className="text-xs font-semibold text-foreground">API · 최근 24시간</h3>
            <TimingTable rows={timings24h.filter((r) => !isInternalRoute(r.route))} />
            <h3 className="text-xs font-semibold text-foreground">API · 최근 7일</h3>
            <TimingTable rows={timings7d.filter((r) => !isInternalRoute(r.route))} />
            <h3 className="text-xs font-semibold text-foreground">AI 추론·DB 지연 · 최근 7일</h3>
            <p>ai:*-load는 인스턴스당 한 번의 모델 로딩(콜드 스타트), ai:*-embed는 1건 추론, db:ping은 기록할 때마다 잰 DB 왕복 시간입니다.</p>
            <TimingTable rows={timings7d.filter((r) => isInternalRoute(r.route))} />
          </div>
        </More>
      </Section>

      <Section title="홍보 전후 비교" description="기준일(홍보 시작일) 앞뒤 같은 길이의 기간을 비교합니다.">
        <form action="/admin/stats" className="flex flex-wrap items-end gap-2 text-sm">
          <input type="hidden" name="unit" value={unit} />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            기준일(홍보 시작일)
            <input type="date" name="pivot" defaultValue={pivot ?? today} className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm text-foreground" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            비교 기간
            <select name="window" defaultValue={String(windowDays)} className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm text-foreground">
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
        {before && after && pivot && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-right text-xs tabular-nums">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 text-left font-medium">지표</th>
                  <th className="py-1.5 pr-3 font-medium">이전 {windowDays}일</th>
                  <th className="py-1.5 pr-3 font-medium">이후 {windowDays}일</th>
                  <th className="py-1.5 font-medium">변화</th>
                </tr>
              </thead>
              <tbody>
                {[...METRICS.map((m) => ({ key: m.key, label: m.label })), ...VISIT_SERIES.filter((s) => s.key !== "internalPv").map((s) => ({ key: s.key, label: s.label }))].map(
                  ({ key, label }) => {
                    const b = before.totals[key];
                    const a = after.totals[key];
                    const partial = before.totalCoverage[key] === "partial" || after.totalCoverage[key] === "partial";
                    const basisChanged = key === "searchKeyword" && before.range.from < basisDay && basisDay < after.range.until;
                    const source = SOURCE_OF[key];
                    return (
                      <tr key={key} className="border-t border-border">
                        <td className="py-1.5 pr-3 text-left text-foreground">
                          {label}
                          {(partial || basisChanged) && (
                            <span className="ml-1 text-[10px] text-warning">
                              ※ {basisChanged ? "집계 기준 변경" : `${source ? sinceLabel(source) : ""}부터 집계`}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          <Num v={b} />
                        </td>
                        <td className="py-1.5 pr-3">
                          <Num v={a} />
                        </td>
                        <td className="py-1.5">{change(b, a)}</td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              이전: 기준일 전 {windowDays}일, 이후: 기준일 포함 {windowDays}일. 활성 회원은 각 기간의 서로 다른 회원 수입니다. 미측정 기간이 섞인
              지표(※)는 실제보다 적게 보이며, &lsquo;집계 기준 변경&rsquo; 지표는 직접 비교하지 마세요.
            </p>
          </div>
        )}
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
