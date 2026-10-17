import Link from "next/link";
import type { ReactNode } from "react";

import { ADMIN_ACTIVITY_ACTIONS, ADMIN_TASK_CATEGORIES, LOGGED_CATEGORIES, type AdminTaskCategory } from "@/lib/admin/activityLog";
import { HISTORY_LIMIT, STRIP_DAYS, type AdminActivityReport, type AdminActivityRow } from "@/lib/metrics/adminActivity";
import { LAST_ACTIVE_INTERVAL_MINUTES } from "@/lib/metrics/activityTime";
import { DAY_TONES, GroupedBarChart, StackedBarChart } from "@/components/admin/StatsCharts";
import { More, Section, Unmeasured } from "@/components/admin/StatsBlocks";
import { InfoIcon } from "@/components/icons";

// 관리자 활동 tab of /admin/stats (see lib/metrics/adminActivity.ts for what
// each figure is read from). Server-rendered; no client JS. `all` is false
// for an admin who may see only their own records.

const fmt = (n: number) => n.toLocaleString("ko-KR");
const kst = (at: Date) => new Date(at.getTime() + 9 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
const dayLabel = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const TONE_OF = Object.fromEntries(ADMIN_TASK_CATEGORIES.map((c, i) => [c.key, DAY_TONES[i]])) as Record<AdminTaskCategory, (typeof DAY_TONES)[number]>;
const LABEL_OF = Object.fromEntries(ADMIN_TASK_CATEGORIES.map((c) => [c.key, c.label])) as Record<AdminTaskCategory, string>;
const LOGGED_ACTIONS = Object.values(ADMIN_ACTIVITY_ACTIONS)
  .map((a) => a.label)
  .join(", ");
const STRIP_TEXT = { active: "활동", inactive: "활동 없음", none: "미측정" } as const;

function Fact({ label, children, sub }: { label: string; children: ReactNode; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground tabular-nums">{children}</dd>
      {sub && <dd className="text-[11px] leading-snug text-muted-foreground">{sub}</dd>}
    </div>
  );
}

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

function AdminCard({ row, report, self, all }: { row: AdminActivityRow; report: AdminActivityReport; self: boolean; all: boolean }) {
  // the last 30 days began before the log did
  const windowPartial = report.logSince === null || report.logSince > `${report.days[0]} 00:00`;
  const days = (n: number | null, measured: number, span: number) =>
    n === null ? (
      <Unmeasured />
    ) : (
      <>
        {fmt(n)}일{measured < span && <span className="text-[11px] font-normal text-muted-foreground"> (측정된 {measured}일 중)</span>}
      </>
    );
  return (
    <li className="flex min-w-0 flex-col gap-4 rounded-card border border-border/80 bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
          {row.nickname}
          <span className="text-xs font-normal text-muted-foreground">#{row.id}</span>
          {self && <span className="rounded-full bg-primary-muted px-2 py-0.5 text-[11px] font-medium text-primary">나</span>}
          {!row.isAdmin && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">현재 관리자 아님</span>}
        </p>
        <div className="flex gap-3 text-xs">
          {all && (
            <Link href={`/admin/stats?tab=admins&a=${row.id}#history`} className="text-primary hover:underline">
              작업 이력
            </Link>
          )}
          <Link href={`/admin/users/${row.id}`} className="text-primary hover:underline">
            회원 상세
          </Link>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="최근 로그인">{row.lastLoginAt ? kst(row.lastLoginAt) : "기록 없음"}</Fact>
        <Fact label="최근 활동 감지">{row.lastActiveAt ? kst(row.lastActiveAt) : report.lastActiveSince ? "기록 없음" : <Unmeasured />}</Fact>
        <Fact label="최근 관리 작업">{row.lastTaskAt ? kst(row.lastTaskAt) : "기록 없음"}</Fact>
        <Fact label="활동일 (최근 7일)">{days(row.activeDays7, report.measuredDays7, 7)}</Fact>
        <Fact label={`활동일 (최근 ${STRIP_DAYS}일)`}>{days(row.activeDays30, report.measuredDays30, STRIP_DAYS)}</Fact>
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
    </li>
  );
}

export function AdminActivityView({ report, viewer, all, focus }: { report: AdminActivityReport; viewer: number; all: boolean; focus: number | null }) {
  const labels = report.days.map(dayLabel);
  const partialNote = (
    <>
      * {LOGGED_CATEGORIES.map((c) => LABEL_OF[c]).join(", ")}에 속한 작업 중 {LOGGED_ACTIONS}은(는){" "}
      {report.logSince ? <b className="font-medium text-foreground">{report.logSince}</b> : "이 화면을 처음 연 때"}부터 기록합니다. 그 전의 이 작업들은
      미측정이며 건수에 들어 있지 않습니다(추정하지 않음).
    </>
  );
  const focused = focus !== null ? report.admins.find((a) => a.id === focus) : undefined;
  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-1 ${active ? "border-primary bg-primary-muted text-primary" : "border-border text-muted-foreground hover:text-foreground"}`;

  return (
    <div className="flex flex-col gap-6">
      <p role="note" className="flex gap-2 rounded-card border border-border bg-card px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" />
        <span>
          {all ? "전체 보기 권한으로 모든 관리자의 기록을 보고 있습니다." : "내 기록만 표시합니다. 다른 관리자의 기록은 지정된 상위 관리자만 볼 수 있습니다."}{" "}
          관리 작업은 서버에서 완료된 작업만 셉니다(화면 이동·클릭은 기록하지 않음).
        </span>
      </p>

      <Section
        title={all ? "관리자별 현황" : "내 관리 활동"}
        description={
          <More label="각 항목의 기준">
            <ul className="flex list-disc flex-col gap-1 pl-4">
              <li>최근 로그인: 마지막으로 Google 로그인을 마친 시각.</li>
              <li>
                최근 활동 감지: 로그인 상태로 화면을 보거나 조작한 마지막 감지 시각(최대 {LAST_ACTIVE_INTERVAL_MINUTES}분 늦게 기록).
                {report.lastActiveSince ? ` ${report.lastActiveSince}부터 기록.` : " 아직 기록을 시작하지 않았습니다."}
              </li>
              <li>최근 관리 작업: 아래 관리 작업 중 가장 최근 것.</li>
              <li>활동일: 로그인 상태로 서비스를 이용한 날(관리 작업 여부와 무관). 수집 시작 전이거나 보유기간이 지난 날은 미측정.</li>
              <li>보유 기록 전체: 지금 남아 있는 기록 기준(보유기간이 지나 삭제된 기록은 빠짐).</li>
              <li>신고 처리에 따른 조치(게시물 삭제, 이용 제한 등)는 해당 조치 항목에도 함께 셉니다.</li>
            </ul>
          </More>
        }
      >
        {report.admins.length === 0 ? (
          <p className="text-xs text-muted-foreground">표시할 관리자가 없습니다.</p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {report.admins.map((row) => (
              <AdminCard key={row.id} row={row} report={report} self={row.id === viewer} all={all} />
            ))}
          </ul>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">{partialNote}</p>
      </Section>

      <Section title={`일별 추이 (최근 ${STRIP_DAYS}일)`} description={all ? "모든 관리자 합계." : "내 기록만."}>
        <StackedBarChart
          title="일별 관리 작업"
          unit="건"
          labels={labels}
          inProgress
          coverage={report.taskCoverage}
          series={ADMIN_TASK_CATEGORIES.map((c) => ({ label: c.label, tone: TONE_OF[c.key], values: report.dailyTasks.map((d) => d[c.key]) }))}
          note={<span>흐린 막대: 일부 작업을 아직 기록하지 않던 날(부분 측정).</span>}
        />
        <GroupedBarChart
          title={all ? "일별 활동한 관리자 수" : "일별 활동 여부 (1 = 활동)"}
          unit={all ? "명" : ""}
          labels={labels}
          inProgress
          coverage={report.dayStatus}
          series={[{ label: all ? "활동한 관리자" : "활동", tone: 1, values: report.dailyActiveAdmins }]}
        />
      </Section>

      <section id="history" className="flex scroll-mt-20 flex-col gap-4 rounded-card border border-border bg-card p-4 md:p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-foreground">관리 작업 이력</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            최근 {STRIP_DAYS}일({report.historyFrom}부터), 최신순 최대 {HISTORY_LIMIT}건{focused ? ` · ${focused.nickname}` : all ? " · 모든 관리자" : ""}. 대상은
            번호로만 표시합니다.
          </p>
        </div>
        {all && report.admins.length > 1 && (
          <nav aria-label="관리자 선택" className="flex flex-wrap gap-1.5 text-xs">
            <Link href="/admin/stats?tab=admins#history" aria-current={focus === null ? "page" : undefined} className={chip(focus === null)}>
              전체
            </Link>
            {report.admins.map((a) => (
              <Link key={a.id} href={`/admin/stats?tab=admins&a=${a.id}#history`} aria-current={focus === a.id ? "page" : undefined} className={chip(focus === a.id)}>
                {a.nickname}
              </Link>
            ))}
          </nav>
        )}
        {report.history.length === 0 ? (
          <p className="text-xs text-muted-foreground">이 기간에 기록된 관리 작업이 없습니다.</p>
        ) : (
          <ol className="flex flex-col">
            {report.history.map((e, i) => (
              <li key={i} className="flex flex-col gap-0.5 border-t border-border/70 py-2 text-xs first:border-t-0 sm:flex-row sm:items-center sm:gap-3">
                <time dateTime={e.at.toISOString()} className="shrink-0 tabular-nums text-muted-foreground sm:w-32">
                  {kst(e.at)}
                </time>
                <span className="shrink-0 font-medium text-foreground sm:w-28 sm:truncate">{e.nickname}</span>
                <span className="min-w-0 flex-1 text-foreground">
                  <span className="mr-1.5 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{LABEL_OF[e.category]}</span>
                  {e.label}
                  {e.target && <span className="text-muted-foreground"> · {e.target}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">{partialNote}</p>
      </section>
    </div>
  );
}
