import Link from "next/link";
import type { ReactNode } from "react";

import { ADMIN_ACTIVITY_ACTIONS, ADMIN_TASK_CATEGORIES, ADMIN_VISIT_GAP_MINUTES, LOGGED_CATEGORIES, type AdminTaskCategory } from "@/lib/admin/activityLog";
import {
  STRIP_DAYS,
  TIMELINE_KINDS,
  TIMELINE_LIMIT,
  type ActivityPeriod,
  type AdminActivityReport,
  type AdminActivityRow,
  type TimelineItem,
  type TimelineKind,
} from "@/lib/metrics/adminActivity";
import {
  adminFigures,
  byHour,
  byWeekdayHour,
  eventsIn,
  peaks,
  periodView,
  rankByTasks,
  totalsOf,
  WEEKDAYS,
  type AdminPeriodFigures,
  type PeriodView,
} from "@/lib/metrics/adminActivityStats";
import { LAST_ACTIVE_INTERVAL_MINUTES } from "@/lib/metrics/activityTime";
import { BarList, DAY_TONES, GroupedBarChart, HourHeatmap, StackedBarChart } from "@/components/admin/StatsCharts";
import { More, Section, StatTile, Unmeasured } from "@/components/admin/StatsBlocks";
import { AlertIcon, InfoIcon } from "@/components/icons";

// 관리자 활동 tab of /admin/stats (see lib/metrics/adminActivity.ts for what
// each figure is read from, adminActivityStats.ts for the period views).
// Server-rendered; every control is a link or a plain GET form, so no client
// JS. `all` is false for an admin who may see only their own records -- the
// loader then never reads anyone else's, whatever the URL asks.
//
// 방문 / 로그인 (presence) and 관리 작업 (work) are always separate figures,
// charts and rankings; the ranking is by 관리 작업 only.

export type HourMetric = "visit" | "login";
export type DayMetric = "visit" | "login" | "task";
export type DashboardOptions = { period: ActivityPeriod; hourMetric: HourMetric; dayMetric: DayMetric };

const fmt = (n: number) => n.toLocaleString("ko-KR");
const kst = (at: Date) => new Date(at.getTime() + 9 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
const kstTime = (at: Date) => kst(at).slice(11);
const dayLabel = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const WEEKDAY_OF = (day: string) => WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7];
const TONE_OF = Object.fromEntries(ADMIN_TASK_CATEGORIES.map((c, i) => [c.key, DAY_TONES[i]])) as Record<AdminTaskCategory, (typeof DAY_TONES)[number]>;
const LABEL_OF = Object.fromEntries(TIMELINE_KINDS.map((c) => [c.key, c.label])) as Record<TimelineKind, string>;
const LOGGED_ACTIONS = Object.values(ADMIN_ACTIVITY_ACTIONS)
  .map((a) => a.label)
  .join(", ");
const STRIP_TEXT = { active: "활동", inactive: "활동 없음", none: "미측정" } as const;
// timeline: presence in blue (visit filled, sign-in hollow), each task
// category its own colour; the label is always written next to it
// (literal classes for Tailwind)
const DOT_OF: Record<TimelineKind, string> = {
  visit: "bg-chart-1",
  login: "border-2 border-chart-1 bg-card",
  report: "bg-chart-2",
  content: "bg-chart-5",
  sanction: "bg-chart-6",
  role: "bg-chart-8",
  review: "bg-chart-7",
  operations: "bg-chart-3",
  access: "bg-chart-4",
};
const METRIC_TEXT: Record<DayMetric, { label: string; unit: string }> = {
  visit: { label: "방문", unit: "회" },
  login: { label: "로그인", unit: "회" },
  task: { label: "관리 작업", unit: "건" },
};

type Ctx = { report: AdminActivityReport; viewer: number; all: boolean; options: DashboardOptions; view: PeriodView; admin: number | null };

// /admin/stats?tab=admins with the dashboard's state, changed by `patch`
function hrefOf(ctx: Ctx, patch: Record<string, string | number | null>, hash = "") {
  const state: Record<string, string | number | null> = {
    a: ctx.all ? ctx.admin : null,
    p: ctx.options.period,
    hm: ctx.options.hourMetric,
    dm: ctx.options.dayMetric,
    day: ctx.report.filter.day,
    k: ctx.report.filter.kind,
    ...patch,
  };
  const q = new URLSearchParams({ tab: "admins" });
  for (const [k, v] of Object.entries(state)) if (v !== null && v !== "") q.set(k, String(v));
  return `/admin/stats?${q.toString()}${hash}`;
}

function Segmented({ items, label }: { items: { href: string; text: string; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="inline-flex self-start rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
      {items.map((i) => (
        <Link
          key={i.text}
          href={i.href}
          aria-current={i.active ? "true" : undefined}
          scroll={false}
          className={`rounded-md px-2.5 py-1 font-medium ${i.active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
        >
          {i.text}
        </Link>
      ))}
    </nav>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground tabular-nums">{children}</dd>
    </div>
  );
}

const Count = ({ n, partial }: { n: number; partial: boolean }) => (
  <>
    {n === 0 ? <span className="text-muted-foreground/70">0</span> : fmt(n)}
    {partial && (
      <span className="text-muted-foreground" title="일부 미측정">
        *
      </span>
    )}
  </>
);

const valueOr = (v: number | null, unit: string) => (v === null ? <Unmeasured /> : `${fmt(v)}${unit}`);
const timeOr = (d: Date | null) => (d ? kst(d) : "기록 없음");

// ---------- 1. 요약 ----------

function Summary({ ctx, figures }: { ctx: Ctx; figures: AdminPeriodFigures[] }) {
  const { view, options } = ctx;
  const t = totalsOf(figures, view);
  const single = figures.length === 1 ? figures[0] : null;
  const measured = (n: number, unit: string) => (n < options.period ? `측정된 ${n}일 중` : `최근 ${options.period}일`) + unit;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile primary label="관리 작업 (업무)" value={`${fmt(t.tasks)}건`} sub={`완료된 작업 · 최근 ${options.period}일`} />
      <StatTile primary label="방문 (접속)" value={valueOr(t.visits, "회")} sub={measured(view.presenceDays, "")} />
      <StatTile primary label="로그인" value={valueOr(t.signIns, "회")} sub={measured(view.presenceDays, "")} />
      {single ? (
        <StatTile primary label="활동일" value={valueOr(single.activeDays, "일")} sub={measured(view.activityDays, "")} />
      ) : (
        <StatTile primary label="활동한 관리자" value={valueOr(t.activeAdmins, "명")} sub={measured(view.activityDays, " · 현재 관리자")} />
      )}
    </div>
  );
}

// ---------- 2. 관리자별 비교 ----------

function Comparison({ ctx, figures }: { ctx: Ctx; figures: AdminPeriodFigures[] }) {
  const ranked = rankByTasks(figures);
  // each metric sorted by itself; admins with none of it are left out
  const bars = (key: "tasks" | "visits" | "signIns") =>
    [...figures]
      .sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0) || a.id - b.id)
      .filter((f) => (f[key] ?? 0) > 0)
      .map((f) => ({ label: f.nickname, value: f[key] ?? 0 }));
  const noVisits = figures.every((f) => f.visits === null);
  return (
    <>
      <div className="grid gap-5 md:grid-cols-3">
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-foreground">관리 작업 처리 건수 (업무)</h3>
          <BarList rows={bars("tasks")} unit="건" empty="이 기간에 완료된 관리 작업이 없습니다." />
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-foreground">방문 횟수 (접속)</h3>
          {noVisits ? <p className="text-xs text-muted-foreground">미측정 기간입니다.</p> : <BarList rows={bars("visits")} unit="회" empty="이 기간에 방문 기록이 없습니다." />}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-foreground">로그인 횟수</h3>
          {noVisits ? <p className="text-xs text-muted-foreground">미측정 기간입니다.</p> : <BarList rows={bars("signIns")} unit="회" empty="이 기간에 로그인 기록이 없습니다." />}
        </div>
      </div>
      {/* relative: keeps the sr-only (absolute) header text inside the scroll box */}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[720px] text-right text-xs tabular-nums">
          <caption className="sr-only">관리자별 활동량: 관리 작업 처리 건수 순위와 방문·로그인·최근 시각</caption>
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="py-1.5 pr-2 text-left font-medium">
                작업 순위
              </th>
              <th scope="col" className="py-1.5 pr-2 text-left font-medium">
                관리자
              </th>
              <th scope="col" className="py-1.5 pr-2 font-medium">
                관리 작업
              </th>
              <th scope="col" className="py-1.5 pr-2 font-medium">
                방문
              </th>
              <th scope="col" className="py-1.5 pr-2 font-medium">
                로그인
              </th>
              <th scope="col" className="py-1.5 pr-2 font-medium">
                활동일
              </th>
              <th scope="col" className="py-1.5 pr-2 font-medium">
                최근 로그인
              </th>
              <th scope="col" className="py-1.5 pr-2 font-medium">
                마지막 활동
              </th>
              <th scope="col" className="py-1.5 font-medium">
                <span className="sr-only">상세</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-1.5 pr-2 text-left text-muted-foreground">{r.tasks > 0 ? `${r.rank}위` : "–"}</td>
                <th scope="row" className="py-1.5 pr-2 text-left font-medium text-foreground">
                  {r.nickname}
                  {r.id === ctx.viewer && <span className="ml-1 rounded-full bg-primary-muted px-1.5 text-[10px] text-primary">나</span>}
                  {!r.isAdmin && <span className="ml-1 text-[10px] font-normal text-muted-foreground">(현재 관리자 아님)</span>}
                </th>
                <td className="py-1.5 pr-2 font-semibold text-foreground">{fmt(r.tasks)}건</td>
                <td className="py-1.5 pr-2 text-foreground">{r.visits === null ? <span className="text-muted-foreground">미측정</span> : `${fmt(r.visits)}회`}</td>
                <td className="py-1.5 pr-2 text-foreground">{r.signIns === null ? <span className="text-muted-foreground">미측정</span> : `${fmt(r.signIns)}회`}</td>
                <td className="py-1.5 pr-2 text-foreground">{r.activeDays === null ? <span className="text-muted-foreground">미측정</span> : `${fmt(r.activeDays)}일`}</td>
                <td className="py-1.5 pr-2 text-muted-foreground">{timeOr(r.lastLoginAt)}</td>
                <td className="py-1.5 pr-2 text-muted-foreground">{timeOr(r.lastActiveAt)}</td>
                <td className="py-1.5 text-left">
                  <Link href={hrefOf(ctx, { a: r.id, day: null })} className="text-primary hover:underline">
                    상세
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        순위는 완료된 관리 작업 건수로만 매깁니다. 방문·로그인은 접속 기록이며 업무량을 뜻하지 않습니다. 대화·실명 열람도 관리 작업에 포함됩니다.
      </p>
    </>
  );
}

// ---------- 3. 일별 활동 (잔디) ----------

const HEAT = [14, 28, 42, 58, 75];
function heatStyle(v: number, max: number) {
  const p = HEAT[Math.min(HEAT.length - 1, Math.max(0, Math.ceil((v / Math.max(1, max)) * HEAT.length) - 1))];
  return { backgroundColor: `color-mix(in srgb, var(--chart-1) ${p}%, transparent)` };
}

type DayRow = { key: string; label: string; adminId: number; values: (number | null)[]; partial: boolean[]; unit: string };

function DayHeatmap({ ctx, rows, caption }: { ctx: Ctx; rows: DayRow[]; caption: string }) {
  const { view } = ctx;
  const max = Math.max(0, ...rows.flatMap((r) => r.values.map((v) => v ?? 0)));
  const selected = ctx.report.filter.day;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-hidden>
        <span className="flex items-center gap-1">
          적음
          {HEAT.map((p) => (
            <span key={p} className="inline-block size-2.5 rounded-[3px]" style={{ backgroundColor: `color-mix(in srgb, var(--chart-1) ${p}%, transparent)` }} />
          ))}
          많음
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-[3px] bg-muted" /> 0 (활동 없음)
        </span>
        <span className="flex items-center gap-1">
          <span className="chart-hatch inline-block size-2.5 rounded-[3px] border border-border bg-muted" /> 미측정(기록 전)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-[3px] border border-dotted border-foreground/50" /> 일부 미측정
        </span>
      </div>
      <div className="relative overflow-x-auto rounded-lg border border-border">
        <table className={`w-full border-separate border-spacing-0.5 text-center text-[10px] leading-none tabular-nums ${view.days.length > 7 ? "min-w-[40rem]" : ""}`}>
          <caption className="sr-only">{caption}. 칸을 누르면 그날의 타임라인을 봅니다.</caption>
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-card px-1.5 py-1 text-left font-medium">
                <span className="sr-only">항목</span>
              </th>
              {view.days.map((d) => (
                <th key={d} scope="col" className={`py-1 font-medium ${d === selected ? "text-primary" : ""}`}>
                  <span className="block">{view.days.length > 7 ? Number(d.slice(8, 10)) : dayLabel(d)}</span>
                  <span className="block text-[9px] font-normal">{WEEKDAY_OF(d)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="sticky left-0 z-10 max-w-24 truncate bg-card px-1.5 text-left font-medium whitespace-nowrap text-foreground">
                  {r.label}
                </th>
                {r.values.map((v, i) => {
                  const day = view.days[i];
                  const text = v === null ? "미측정" : `${fmt(v)}${r.unit}${r.partial[i] ? " (일부 미측정)" : ""}`;
                  const title = `${r.label} ${day}: ${text}`;
                  const ring = day === selected ? "ring-2 ring-primary" : "";
                  if (v === null)
                    return (
                      <td key={day} title={title} className={`chart-hatch h-7 min-w-5 rounded-[3px] bg-muted/60 ${ring}`}>
                        <span className="sr-only">{title}</span>
                      </td>
                    );
                  return (
                    <td key={day} className={`h-7 min-w-5 rounded-[3px] p-0 ${v === 0 ? "bg-muted" : ""} ${r.partial[i] ? "border border-dotted border-foreground/50" : ""} ${ring}`} style={v > 0 ? heatStyle(v, max) : undefined}>
                      <Link
                        href={hrefOf(ctx, { a: ctx.all ? r.adminId : null, day }, "#timeline")}
                        title={title}
                        className="flex h-7 items-center justify-center font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span aria-hidden>{v > 0 ? fmt(v) : ""}</span>
                        <span className="sr-only">{title}</span>
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function rowFor(row: AdminActivityRow, metric: DayMetric, ctx: Ctx, label = row.nickname): DayRow {
  const { view } = ctx;
  const slice = <T,>(a: T[]) => a.slice(view.offset);
  const values = metric === "visit" ? slice(row.visits) : metric === "login" ? slice(row.signIns) : slice(row.tasksByDay);
  const partial =
    metric === "task" ? view.taskCoverage.map((c) => c === "partial") : view.presenceStatus.map((c) => c === "partial");
  return { key: `${row.id}:${metric}`, label, adminId: row.id, values, partial, unit: METRIC_TEXT[metric].unit };
}

function DailySection({ ctx, rows }: { ctx: Ctx; rows: AdminActivityRow[] }) {
  const { view, options, report } = ctx;
  const one = rows.length === 1 ? rows[0] : null;
  const heatRows = one
    ? (["visit", "login", "task"] as const).map((m) => rowFor(one, m, ctx, METRIC_TEXT[m].label))
    : rows.map((r) => rowFor(r, options.dayMetric, ctx));
  const slice = <T,>(a: T[]) => a.slice(view.offset);
  const labels = view.days.map(dayLabel);
  const sumDay = (pick: (r: AdminActivityRow) => (number | null)[]) =>
    view.days.map((_, i) => (view.presenceStatus[i] === "none" ? null : rows.reduce((a, r) => a + (pick(r)[view.offset + i] ?? 0), 0)));
  const tasksPerCategory = slice(report.dailyTasks);
  return (
    <Section
      title="일별 활동"
      description={`최근 ${options.period}일, 한국 시간. 칸을 누르면 그날의 타임라인으로 이동합니다. 숫자는 칸 안과 마우스를 올렸을 때 보입니다.`}
    >
      {!one && (
        <Segmented
          label="일별 히트맵 지표"
          items={(["task", "visit", "login"] as const).map((m) => ({ href: hrefOf(ctx, { dm: m }, "#daily"), text: METRIC_TEXT[m].label, active: options.dayMetric === m }))}
        />
      )}
      <div id="daily" className="scroll-mt-24">
        <DayHeatmap ctx={ctx} rows={heatRows} caption={one ? `${one.nickname}의 일별 방문·로그인·관리 작업` : `관리자별 일별 ${METRIC_TEXT[options.dayMetric].label}`} />
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <GroupedBarChart
          title={`일별 방문·로그인 (최근 ${options.period}일)`}
          unit="회"
          labels={labels}
          inProgress
          coverage={view.presenceStatus}
          tickEvery={options.period === 7 ? 1 : undefined}
          series={[
            { label: "방문", tone: 1, values: sumDay((r) => r.visits) },
            { label: "로그인", tone: 3, values: sumDay((r) => r.signIns) },
          ]}
        />
        <StackedBarChart
          title={`일별 관리 작업 (최근 ${options.period}일)`}
          unit="건"
          labels={labels}
          inProgress
          coverage={view.taskCoverage}
          tickEvery={options.period === 7 ? 1 : undefined}
          series={
            one || !ctx.all || ctx.admin !== null
              ? [{ label: "관리 작업", tone: 2, values: slice(rows[0]?.tasksByDay ?? view.days.map(() => 0)) }]
              : ADMIN_TASK_CATEGORIES.map((c) => ({ label: c.label, tone: TONE_OF[c.key], values: tasksPerCategory.map((d) => d[c.key]) }))
          }
          note={<span>흐린 막대: 일부 작업을 아직 기록하지 않던 날이나 기록 저장에 실패한 날(부분 측정).</span>}
        />
      </div>
    </Section>
  );
}

// ---------- 4·5. 시간대·요일 ----------

function HourSection({ ctx, rows }: { ctx: Ctx; rows: AdminActivityRow[] }) {
  const { report, view, options } = ctx;
  const metric = options.hourMetric;
  const source = metric === "visit" ? report.visitEvents : report.signInEvents;
  const scopeId = rows.length === 1 ? rows[0].id : null;
  const times = eventsIn(source, view, scopeId);
  const hours = byHour(times);
  const grid = byWeekdayHour(times);
  const unmeasured = view.presenceDays === 0;
  const label = metric === "visit" ? "방문 시작" : "로그인";
  const peakHours = peaks(hours);
  const flat = grid.flat();
  const peakCells = peaks(flat).map((i) => `${WEEKDAYS[Math.floor(i / 24)]} ${i % 24}시`);
  const status = (n: number) => Array.from({ length: n }, () => (unmeasured ? "none" : view.presenceDays < options.period ? "partial" : "full") as "none" | "partial" | "full");
  return (
    <Section
      title="시간대별 방문·로그인"
      description={`최근 ${options.period}일, 한국 시간. 방문은 시작한 시각에 한 번만 셉니다(${ADMIN_VISIT_GAP_MINUTES}분 이상 쉬면 새 방문). 관리 작업을 한 시각과는 다른 지표입니다.`}
    >
      <Segmented
        label="시간대 지표"
        items={(["visit", "login"] as const).map((m) => ({ href: hrefOf(ctx, { hm: m }, "#hours"), text: m === "visit" ? "방문" : "로그인", active: metric === m }))}
      />
      <div id="hours" className="flex scroll-mt-24 flex-col gap-5">
        {unmeasured ? (
          <p className="text-xs text-muted-foreground">이 기간은 방문·로그인 기록 전이라 미측정입니다.</p>
        ) : (
          <>
            <p className="text-xs text-foreground">
              {times.length === 0
                ? `이 기간에 ${label} 기록이 없습니다.`
                : `${label} ${fmt(times.length)}회 · 가장 많은 시간대 ${peakHours.map((h) => `${h}시`).join(", ")} · 가장 많은 요일·시간 ${peakCells.slice(0, 3).join(", ")}${peakCells.length > 3 ? " 외" : ""}`}
              {view.presenceDays < options.period && <span className="text-muted-foreground"> (측정된 {view.presenceDays}일 기준)</span>}
            </p>
            <GroupedBarChart
              title={`시간대별 ${label} (0~23시)`}
              unit="회"
              labels={Array.from({ length: 24 }, (_, h) => `${h}시`)}
              tickEvery={3}
              series={[{ label, tone: metric === "visit" ? 1 : 3, values: hours }]}
            />
            <HourHeatmap
              title={`요일 × 시간대 ${label}`}
              unit="회"
              rowLabel="요일"
              rows={WEEKDAYS.map((w, i) => ({ label: w, values: grid[i], status: status(24) }))}
            />
            {ctx.all && ctx.admin === null && rows.length > 1 && (
              <HourHeatmap
                title={`관리자별 시간대 ${label} 비교`}
                unit="회"
                rowLabel="관리자"
                rows={rows.map((r) => ({ label: r.nickname, values: byHour(eventsIn(source, view, r.id)), status: status(24) }))}
              />
            )}
          </>
        )}
      </div>
    </Section>
  );
}

// ---------- 상세 (one admin) ----------

function ActiveStrip({ row, days }: { row: AdminActivityRow; days: string[] }) {
  const active = row.strip.filter((s) => s === "active").length;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] text-muted-foreground">
        최근 {STRIP_DAYS}일 활동일 ({dayLabel(days[0])}~{dayLabel(days[days.length - 1])}) · 채움: 활동, 점선: 미측정
      </p>
      <ol className="grid grid-cols-[repeat(30,minmax(0,1fr))] gap-0.5" aria-label={`최근 ${STRIP_DAYS}일 중 활동일 ${active}일`}>
        {row.strip.map((s, i) => (
          <li
            key={days[i]}
            title={`${days[i]}: ${STRIP_TEXT[s]}`}
            className={`h-4 rounded-[3px] ${s === "active" ? "bg-primary" : s === "inactive" ? "bg-muted" : "border border-dashed border-border"}`}
          >
            <span className="sr-only">
              {days[i]} {STRIP_TEXT[s]}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AdminDetail({ ctx, row }: { ctx: Ctx; row: AdminActivityRow }) {
  const { report } = ctx;
  // the last 30 days began before the log did
  const windowPartial = report.logSince === null || report.logSince > `${report.days[0]} 00:00`;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
          {row.nickname}
          <span className="text-xs font-normal text-muted-foreground">#{row.id}</span>
          {row.id === ctx.viewer && <span className="rounded-full bg-primary-muted px-2 py-0.5 text-[11px] font-medium text-primary">나</span>}
          {!row.isAdmin && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">현재 관리자 아님</span>}
        </p>
        <Link href={`/admin/users/${row.id}`} className="text-xs text-primary hover:underline">
          회원 상세
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Fact label="최근 로그인">{timeOr(row.lastLoginAt)}</Fact>
        <Fact label="최근 방문 시작">{row.lastVisit ? kst(row.lastVisit.start) : report.presenceSince ? "기록 없음" : <Unmeasured />}</Fact>
        <Fact label="마지막 활동 감지">{row.lastActiveAt ? kst(row.lastActiveAt) : report.lastActiveSince ? "기록 없음" : <Unmeasured />}</Fact>
        <Fact label="최근 관리 작업">{timeOr(row.lastTaskAt)}</Fact>
      </dl>
      <ActiveStrip row={row} days={report.days} />
      <table className="w-full text-xs tabular-nums">
        <caption className="sr-only">{row.nickname}의 관리 작업 처리 건수</caption>
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 text-left font-medium">관리 작업</th>
            <th className="py-1 text-right font-medium">최근 {STRIP_DAYS}일</th>
            <th className="py-1 text-right font-medium">보유 기록 전체</th>
          </tr>
        </thead>
        <tbody>
          {ADMIN_TASK_CATEGORIES.map((c) => {
            const logged = LOGGED_CATEGORIES.includes(c.key);
            return (
              <tr key={c.key} className="border-t border-border/70">
                <th scope="row" className="py-1.5 text-left font-normal text-foreground">
                  <span className={`mr-1.5 inline-block size-2 rounded-full ${DOT_OF[c.key]}`} aria-hidden />
                  {c.label}
                </th>
                <td className="py-1.5 text-right text-foreground">
                  <Count n={row.tasks30[c.key]} partial={logged && windowPartial} />
                </td>
                <td className="py-1.5 text-right text-foreground">
                  <Count n={row.tasksAll[c.key]} partial={logged} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 6. 타임라인 ----------

function TimelineFilterForm({ ctx }: { ctx: Ctx }) {
  const { report, options, view } = ctx;
  const { filter } = report;
  const select = "h-9 min-w-0 rounded-lg border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  return (
    <form method="get" action="/admin/stats#timeline" className="flex flex-wrap items-end gap-2" aria-label="타임라인 필터">
      <input type="hidden" name="tab" value="admins" />
      {ctx.all && ctx.admin !== null && <input type="hidden" name="a" value={ctx.admin} />}
      <input type="hidden" name="p" value={options.period} />
      <input type="hidden" name="hm" value={options.hourMetric} />
      <input type="hidden" name="dm" value={options.dayMetric} />
      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        날짜
        <select name="day" defaultValue={filter.day ?? ""} className={select}>
          <option value="">최근 {options.period}일 전체</option>
          {[...view.days].reverse().map((d) => (
            <option key={d} value={d}>
              {d} ({WEEKDAY_OF(d)})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        종류
        <select name="k" defaultValue={filter.kind ?? ""} className={select}>
          <option value="">전체</option>
          {TIMELINE_KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="h-9 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        적용
      </button>
      {(filter.day !== null || filter.kind !== null) && (
        <Link href={hrefOf(ctx, { day: null, k: null }, "#timeline")} className="h-9 px-1 text-xs leading-9 text-primary hover:underline">
          날짜·종류 해제
        </Link>
      )}
    </form>
  );
}

function visitSpan(start: Date, until: Date) {
  const minutes = Math.round((until.getTime() - start.getTime()) / 60_000);
  return minutes < 1 ? `${kstTime(start)} 방문 시작 · 활동 1회 기록` : `${kstTime(start)} ~ ${kstTime(until)} (약 ${fmt(minutes)}분)`;
}

function Timeline({ ctx }: { ctx: Ctx }) {
  const { report, options } = ctx;
  // newest day first, each day's items newest first (as read)
  const byDay = new Map<string, TimelineItem[]>();
  for (const e of report.timeline) {
    const day = kst(e.at).slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  const focused = ctx.admin !== null ? report.admins.find((a) => a.id === ctx.admin) : undefined;
  const filterText = [
    focused ? focused.nickname : ctx.all ? "모든 관리자" : null,
    report.filter.day ?? `최근 ${options.period}일`,
    report.filter.kind ? LABEL_OF[report.filter.kind] : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section id="timeline" className="flex scroll-mt-20 flex-col gap-4 rounded-card border border-border bg-card p-4 md:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">활동 타임라인</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          로그인·방문 시작·완료된 관리 작업을 날짜별로 최신순으로 보여 줍니다. {filterText} · {fmt(report.timelineMatched)}건
          {report.timelineMatched > TIMELINE_LIMIT && ` 중 최신 ${TIMELINE_LIMIT}건`}
          {report.timelineCapped && " (관리 작업이 많아 일부만 읽었습니다. 날짜·종류로 좁혀 주세요)"}. 대상은 번호로만 표시합니다.
        </p>
      </div>
      <TimelineFilterForm ctx={ctx} />
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label="종류별 색">
        {TIMELINE_KINDS.map((k) => (
          <li key={k.key} className="flex items-center gap-1">
            <span className={`inline-block size-2 rounded-full ${DOT_OF[k.key]}`} aria-hidden />
            {k.label}
          </li>
        ))}
      </ul>
      {report.timeline.length === 0 ? (
        <p className="text-xs text-muted-foreground">조건에 맞는 기록이 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {[...byDay].map(([day, items]) => (
            <div key={day} className="flex flex-col">
              <h3 className="sticky top-14 z-[1] bg-card py-1 text-xs font-semibold text-foreground">
                {day} ({WEEKDAY_OF(day)}) <span className="font-normal text-muted-foreground">· {fmt(items.length)}건</span>
              </h3>
              <ol className="flex flex-col border-l border-border pl-3">
                {items.map((e, i) => (
                  <li key={i} className="relative flex flex-col gap-0.5 py-1.5 text-xs sm:flex-row sm:items-center sm:gap-3">
                    <span className={`absolute top-3 -left-[17px] size-2 rounded-full ring-2 ring-card ${DOT_OF[e.kind]}`} aria-hidden />
                    <time dateTime={e.at.toISOString()} className="shrink-0 tabular-nums text-muted-foreground sm:w-12">
                      {kstTime(e.at)}
                    </time>
                    <span className="shrink-0 font-medium text-foreground sm:w-28 sm:truncate">{e.nickname}</span>
                    <span className="min-w-0 flex-1 text-foreground">
                      <span className="mr-1.5 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{LABEL_OF[e.kind]}</span>
                      {e.kind === "visit" && e.until ? visitSpan(e.at, e.until) : e.label}
                      {e.target && <span className="text-muted-foreground"> · {e.target}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        방문·로그인은 {report.presenceSince ? <b className="font-medium text-foreground">{report.presenceSince}</b> : "이 화면을 처음 연 때"}부터 기록합니다. 그 전은
        미측정이며 추정하지 않습니다. 방문의 끝 시각은 마지막으로 기록된 활동이며 최대 {LAST_ACTIVE_INTERVAL_MINUTES}분 늦을 수 있습니다.
      </p>
    </section>
  );
}

// ---------- common ----------

function FailureAlert({ counts, days, what }: { counts: number[]; days: string[]; what: string }) {
  const total = counts.reduce((a, n) => a + n, 0);
  if (total === 0) return null;
  const on = days.filter((_, i) => counts[i] > 0);
  return (
    <p role="alert" className="flex gap-2 rounded-card border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-foreground">
      <AlertIcon className="mt-0.5 size-4 shrink-0" />
      <span>
        최근 {STRIP_DAYS}일 동안 {what} {fmt(total)}건의 기록을 저장하지 못했습니다(모든 관리자 기준, {on.map(dayLabel).join(", ")}). 해당 날짜의 건수와
        타임라인에는 이 기록이 빠져 있습니다. 서버 오류 로그의 &lsquo;[admin-activity]&rsquo; 항목에서 종류와 번호를 확인할 수 있습니다.
      </span>
    </p>
  );
}

function FilterBar({ ctx }: { ctx: Ctx }) {
  const { report, options } = ctx;
  const select = "h-9 min-w-0 rounded-lg border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-card border border-border bg-card px-3 py-2">
      {ctx.all && (
        <form method="get" action="/admin/stats" className="flex items-end gap-2" aria-label="관리자 선택">
          <input type="hidden" name="tab" value="admins" />
          <input type="hidden" name="p" value={options.period} />
          <input type="hidden" name="hm" value={options.hourMetric} />
          <input type="hidden" name="dm" value={options.dayMetric} />
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            관리자
            <select name="a" defaultValue={ctx.admin ?? ""} className={select}>
              <option value="">전체 관리자 비교</option>
              {report.admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nickname} (#{a.id})
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted">
            보기
          </button>
        </form>
      )}
      <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        기간
        <Segmented
          label="기간"
          items={([7, 30] as const).map((p) => ({ href: hrefOf(ctx, { p, day: null }), text: `최근 ${p}일`, active: options.period === p }))}
        />
      </div>
      {ctx.all && ctx.admin !== null && (
        <Link href={hrefOf(ctx, { a: null, day: null })} className="h-9 text-xs leading-9 text-primary hover:underline">
          ← 전체 관리자 비교
        </Link>
      )}
    </div>
  );
}

export function AdminActivityView({ report, viewer, all, options }: { report: AdminActivityReport; viewer: number; all: boolean; options: DashboardOptions }) {
  const admin = all ? report.filter.admin : null;
  const view = periodView(report, options.period);
  const ctx: Ctx = { report, viewer, all, options, view, admin };
  // the admins this page is about: the chosen one, or every admin in scope
  // (just the viewer for an admin without the viewer right)
  const scoped = admin !== null ? report.admins.filter((a) => a.id === admin) : report.admins;
  const figures = scoped.map((r) => adminFigures(r, view));
  const one = scoped.length === 1 ? scoped[0] : null;
  const partialNote = (
    <>
      * {LOGGED_CATEGORIES.map((c) => LABEL_OF[c]).join(", ")}에 속한 작업 중 {LOGGED_ACTIONS}은(는){" "}
      {report.logSince ? <b className="font-medium text-foreground">{report.logSince}</b> : "이 화면을 처음 연 때"}부터 기록합니다. 그 전의 이 작업들은
      미측정이며 건수에 들어 있지 않습니다(추정하지 않음).
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <p role="note" className="flex gap-2 rounded-card border border-border bg-card px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" />
        <span>
          {all ? "전체 보기 권한으로 모든 관리자의 기록을 보고 있습니다." : "내 기록만 표시합니다. 다른 관리자의 기록은 지정된 상위 관리자만 볼 수 있습니다."}{" "}
          관리 작업은 서버에서 완료된 작업만 세고, 화면 이동·클릭·검색어·채팅 내용·게시글 열람은 기록하지 않습니다.
        </span>
      </p>

      <FailureAlert counts={report.recordFailures} days={report.days} what="완료된 관리 작업" />
      <FailureAlert counts={report.visitFailures} days={report.days} what="방문·로그인" />

      <FilterBar ctx={ctx} />

      <Section
        title={one ? (one.id === viewer ? "내 활동 요약" : `${one.nickname} 활동 요약`) : "전체 관리자 요약"}
        description={
          <More label="각 항목의 기준">
            <ul className="flex list-disc flex-col gap-1 pl-4">
              <li>관리 작업: 서버에서 완료된 신고 처리·제재·게시물 조치·권한 변경·심사·공지·설정 변경·대화/실명 열람 기록.</li>
              <li>
                방문: 로그인 상태로 보이는 화면을 보거나 조작한 이용. {ADMIN_VISIT_GAP_MINUTES}분 이상 활동이 없다가 다시 이용하면 새 방문입니다. 페이지 요청 수가
                아니며 백그라운드 탭·자동 새로고침은 세지 않습니다. 시작한 날짜·시각에 한 번만 셉니다.
              </li>
              <li>로그인: Google 로그인을 마친 횟수(로그인이 유지된 방문은 로그인으로 세지 않음).</li>
              <li>활동일: 로그인 상태로 서비스를 이용한 날(관리 작업 여부와 무관).</li>
              <li>
                마지막 활동 감지: 최대 {LAST_ACTIVE_INTERVAL_MINUTES}분 늦게 기록.
                {report.lastActiveSince ? ` ${report.lastActiveSince}부터 기록.` : " 아직 기록을 시작하지 않았습니다."}
              </li>
              <li>신고 처리에 따른 조치(게시물 삭제, 이용 제한 등)는 해당 조치 항목에도 함께 셉니다.</li>
            </ul>
          </More>
        }
      >
        <Summary ctx={ctx} figures={figures} />
        {one && <AdminDetail ctx={ctx} row={one} />}
        <p className="text-[11px] leading-relaxed text-muted-foreground">{partialNote}</p>
      </Section>

      {all && admin === null && report.admins.length > 1 && (
        <Section title="관리자별 비교" description={`최근 ${ctx.options.period}일. 관리 작업(업무)과 방문·로그인(접속)은 서로 다른 지표라 따로 비교합니다.`}>
          <Comparison ctx={ctx} figures={figures} />
        </Section>
      )}

      <DailySection ctx={ctx} rows={scoped} />
      <HourSection ctx={ctx} rows={scoped} />
      <Timeline ctx={ctx} />
    </div>
  );
}
