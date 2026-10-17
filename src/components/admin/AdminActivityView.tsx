import Link from "next/link";
import type { ReactNode } from "react";

import { ADMIN_ACTIVITY_ACTIONS, ADMIN_TASK_CATEGORIES, ADMIN_VISIT_GAP_MINUTES, LOGGED_CATEGORIES, type AdminTaskCategory } from "@/lib/admin/activityLog";
import { STRIP_DAYS, TIMELINE_KINDS, TIMELINE_LIMIT, type AdminActivityReport, type AdminActivityRow, type TimelineKind } from "@/lib/metrics/adminActivity";
import { LAST_ACTIVE_INTERVAL_MINUTES } from "@/lib/metrics/activityTime";
import { DAY_TONES, GroupedBarChart, StackedBarChart } from "@/components/admin/StatsCharts";
import { More, Section, Unmeasured } from "@/components/admin/StatsBlocks";
import { AlertIcon, InfoIcon } from "@/components/icons";

// 관리자 활동 tab of /admin/stats (see lib/metrics/adminActivity.ts for what
// each figure is read from). Server-rendered; the timeline filter is a plain
// GET form, so no client JS. `all` is false for an admin who may see only
// their own records.

const fmt = (n: number) => n.toLocaleString("ko-KR");
const kst = (at: Date) => new Date(at.getTime() + 9 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
const kstTime = (at: Date) => kst(at).slice(11);
const dayLabel = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const TONE_OF = Object.fromEntries(ADMIN_TASK_CATEGORIES.map((c, i) => [c.key, DAY_TONES[i]])) as Record<AdminTaskCategory, (typeof DAY_TONES)[number]>;
const LABEL_OF = Object.fromEntries(TIMELINE_KINDS.map((c) => [c.key, c.label])) as Record<TimelineKind, string>;
const LOGGED_ACTIONS = Object.values(ADMIN_ACTIVITY_ACTIONS)
  .map((a) => a.label)
  .join(", ");
const STRIP_TEXT = { active: "활동", inactive: "활동 없음", none: "미측정" } as const;
const CHIP_TONE: Partial<Record<TimelineKind, string>> = {
  login: "bg-primary-muted text-primary",
  visit: "bg-primary-muted text-primary",
};

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

// 최근 7일: visits and sign-ins per day (– = 미측정)
function WeekTable({ row, days }: { row: AdminActivityRow; days: string[] }) {
  const week = days.slice(-7);
  const offset = days.length - 7;
  const cell = (v: number | null) =>
    v === null ? (
      <span className="text-muted-foreground/60" title="미측정">
        –
      </span>
    ) : v === 0 ? (
      <span className="text-muted-foreground/60">0</span>
    ) : (
      fmt(v)
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[300px] text-center text-xs tabular-nums">
        <caption className="sr-only">{row.nickname}의 최근 7일 일별 방문·로그인 횟수</caption>
        <thead className="text-muted-foreground">
          <tr>
            <th scope="col" className="py-1 text-left font-medium">
              최근 7일
            </th>
            {week.map((d) => (
              <th key={d} scope="col" className="py-1 font-medium">
                {dayLabel(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(
            [
              ["방문", row.visits],
              ["로그인", row.signIns],
            ] as const
          ).map(([label, values]) => (
            <tr key={label} className="border-t border-border/70">
              <th scope="row" className="py-1.5 text-left font-normal text-foreground">
                {label}
              </th>
              {week.map((d, i) => (
                <td key={d} className="py-1.5 text-foreground">
                  {cell(values[offset + i])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
  const days = (n: number | null, measured: number, span: number, unit = "일") =>
    n === null ? (
      <Unmeasured />
    ) : (
      <>
        {fmt(n)}
        {unit}
        {measured < span && <span className="text-[11px] font-normal text-muted-foreground"> (측정된 {measured}일 중)</span>}
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
            <Link href={`/admin/stats?tab=admins&a=${row.id}#timeline`} className="text-primary hover:underline">
              타임라인
            </Link>
          )}
          <Link href={`/admin/users/${row.id}`} className="text-primary hover:underline">
            회원 상세
          </Link>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="최근 로그인">{row.lastLoginAt ? kst(row.lastLoginAt) : "기록 없음"}</Fact>
        <Fact label="최근 방문 시작">{row.lastVisit ? kst(row.lastVisit.start) : report.presenceSince ? "기록 없음" : <Unmeasured />}</Fact>
        <Fact label="마지막 활동 감지">{row.lastActiveAt ? kst(row.lastActiveAt) : report.lastActiveSince ? "기록 없음" : <Unmeasured />}</Fact>
        <Fact label="방문 (최근 7일)">{days(row.visits7, report.presenceDays7, 7, "회")}</Fact>
        <Fact label={`방문 (최근 ${STRIP_DAYS}일)`}>{days(row.visits30, report.presenceDays30, STRIP_DAYS, "회")}</Fact>
        <Fact label="로그인 (최근 7일)">{days(row.signIns7, report.presenceDays7, 7, "회")}</Fact>
        <Fact label="최근 관리 작업">{row.lastTaskAt ? kst(row.lastTaskAt) : "기록 없음"}</Fact>
        <Fact label="활동일 (최근 7일)">{days(row.activeDays7, report.measuredDays7, 7)}</Fact>
        <Fact label={`활동일 (최근 ${STRIP_DAYS}일)`}>{days(row.activeDays30, report.measuredDays30, STRIP_DAYS)}</Fact>
      </dl>
      <WeekTable row={row} days={report.days} />
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

function TimelineFilterForm({ report, all }: { report: AdminActivityReport; all: boolean }) {
  const { filter } = report;
  const select = "h-9 min-w-0 rounded-lg border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  return (
    <form method="get" action="/admin/stats#timeline" className="flex flex-wrap items-end gap-2" aria-label="타임라인 필터">
      <input type="hidden" name="tab" value="admins" />
      {all && (
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          관리자
          <select name="a" defaultValue={filter.admin ?? ""} className={select}>
            <option value="">전체</option>
            {report.admins.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nickname} (#{a.id})
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        날짜
        <select name="day" defaultValue={filter.day ?? ""} className={select}>
          <option value="">최근 {STRIP_DAYS}일 전체</option>
          {[...report.days].reverse().map((d) => (
            <option key={d} value={d}>
              {d}
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
      {(filter.admin !== null || filter.day !== null || filter.kind !== null) && (
        <Link href="/admin/stats?tab=admins#timeline" className="h-9 px-1 text-xs leading-9 text-primary hover:underline">
          필터 해제
        </Link>
      )}
    </form>
  );
}

function visitSpan(start: Date, until: Date) {
  const minutes = Math.round((until.getTime() - start.getTime()) / 60_000);
  return minutes < 1 ? `${kstTime(start)} · 활동 1회 기록` : `${kstTime(start)} ~ ${kstTime(until)} (약 ${fmt(minutes)}분)`;
}

export function AdminActivityView({ report, viewer, all }: { report: AdminActivityReport; viewer: number; all: boolean }) {
  const labels = report.days.map(dayLabel);
  const week = { labels: labels.slice(-7), from: report.days.length - 7 };
  const partialNote = (
    <>
      * {LOGGED_CATEGORIES.map((c) => LABEL_OF[c]).join(", ")}에 속한 작업 중 {LOGGED_ACTIONS}은(는){" "}
      {report.logSince ? <b className="font-medium text-foreground">{report.logSince}</b> : "이 화면을 처음 연 때"}부터 기록합니다. 그 전의 이 작업들은
      미측정이며 건수에 들어 있지 않습니다(추정하지 않음).
    </>
  );
  const presenceNote = (
    <>
      방문·로그인은 {report.presenceSince ? <b className="font-medium text-foreground">{report.presenceSince}</b> : "이 화면을 처음 연 때"}부터 기록합니다.
      그 전 날짜는 미측정입니다(추정하지 않음).
    </>
  );
  const focused = report.filter.admin !== null ? report.admins.find((a) => a.id === report.filter.admin) : undefined;
  const filterText = [
    focused ? focused.nickname : all ? "모든 관리자" : null,
    report.filter.day ?? `최근 ${STRIP_DAYS}일`,
    report.filter.kind ? LABEL_OF[report.filter.kind] : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-6">
      <p role="note" className="flex gap-2 rounded-card border border-border bg-card px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" />
        <span>
          {all ? "전체 보기 권한으로 모든 관리자의 기록을 보고 있습니다." : "내 기록만 표시합니다. 다른 관리자의 기록은 지정된 상위 관리자만 볼 수 있습니다."}{" "}
          관리 작업은 서버에서 완료된 작업만 세고, 화면 이동·클릭·검색어·채팅 내용은 기록하지 않습니다.
        </span>
      </p>

      <FailureAlert counts={report.recordFailures} days={report.days} what="완료된 관리 작업" />
      <FailureAlert counts={report.visitFailures} days={report.days} what="방문·로그인" />

      <Section
        title={all ? "관리자별 현황" : "내 관리 활동"}
        description={
          <More label="각 항목의 기준">
            <ul className="flex list-disc flex-col gap-1 pl-4">
              <li>
                방문: 로그인 상태로 화면을 보거나 조작한 이용을 한 번의 방문으로 셉니다. {ADMIN_VISIT_GAP_MINUTES}분 이상 활동이 없다가 다시 이용하면 새 방문입니다.
                페이지 요청 수가 아니며, 백그라운드 탭·자동 새로고침은 세지 않습니다. 방문은 시작한 날짜에 셉니다.
              </li>
              <li>로그인: Google 로그인을 마친 횟수(로그인 상태가 유지되는 동안의 방문은 로그인으로 세지 않음).</li>
              <li>
                마지막 활동 감지: 로그인 상태로 화면을 보거나 조작한 마지막 감지 시각(최대 {LAST_ACTIVE_INTERVAL_MINUTES}분 늦게 기록).
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
        <p className="text-[11px] leading-relaxed text-muted-foreground">{presenceNote}</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{partialNote}</p>
      </Section>

      <Section title="방문 추이" description={all ? "모든 관리자 합계. 미측정 날짜는 빗금으로 표시합니다." : "내 기록만. 미측정 날짜는 빗금으로 표시합니다."}>
        <GroupedBarChart
          title="일별 방문·로그인 (최근 7일)"
          unit="회"
          labels={week.labels}
          inProgress
          coverage={report.presenceStatus.slice(week.from)}
          series={[
            { label: "방문", tone: 1, values: report.dailyVisits.slice(week.from) },
            { label: "로그인", tone: 3, values: report.dailySignIns.slice(week.from) },
          ]}
        />
        <GroupedBarChart
          title={`일별 방문·로그인 (최근 ${STRIP_DAYS}일)`}
          unit="회"
          labels={labels}
          inProgress
          coverage={report.presenceStatus}
          series={[
            { label: "방문", tone: 1, values: report.dailyVisits },
            { label: "로그인", tone: 3, values: report.dailySignIns },
          ]}
        />
      </Section>

      <Section title={`관리 작업·활동일 추이 (최근 ${STRIP_DAYS}일)`} description={all ? "모든 관리자 합계." : "내 기록만."}>
        <StackedBarChart
          title="일별 관리 작업"
          unit="건"
          labels={labels}
          inProgress
          coverage={report.taskCoverage}
          series={ADMIN_TASK_CATEGORIES.map((c) => ({ label: c.label, tone: TONE_OF[c.key], values: report.dailyTasks.map((d) => d[c.key]) }))}
          note={<span>흐린 막대: 일부 작업을 아직 기록하지 않던 날이나 기록 저장에 실패한 날(부분 측정).</span>}
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

      <section id="timeline" className="flex scroll-mt-20 flex-col gap-4 rounded-card border border-border bg-card p-4 md:p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-foreground">활동 타임라인</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            로그인·방문·관리 작업을 최신순으로 보여 줍니다. {filterText} · {fmt(report.timelineMatched)}건
            {report.timelineMatched > TIMELINE_LIMIT && ` 중 최신 ${TIMELINE_LIMIT}건`}
            {report.timelineCapped && " (관리 작업이 많아 일부만 읽었습니다. 날짜·종류로 좁혀 주세요)"}. 대상은 번호로만 표시합니다.
          </p>
        </div>
        <TimelineFilterForm report={report} all={all} />
        {report.timeline.length === 0 ? (
          <p className="text-xs text-muted-foreground">조건에 맞는 기록이 없습니다.</p>
        ) : (
          <ol className="flex flex-col">
            {report.timeline.map((e, i) => (
              <li key={i} className="flex flex-col gap-0.5 border-t border-border/70 py-2 text-xs first:border-t-0 sm:flex-row sm:items-center sm:gap-3">
                <time dateTime={e.at.toISOString()} className="shrink-0 tabular-nums text-muted-foreground sm:w-32">
                  {kst(e.at)}
                </time>
                <span className="shrink-0 font-medium text-foreground sm:w-28 sm:truncate">{e.nickname}</span>
                <span className="min-w-0 flex-1 text-foreground">
                  <span className={`mr-1.5 rounded-md px-1.5 py-0.5 text-[11px] ${CHIP_TONE[e.kind] ?? "bg-muted text-muted-foreground"}`}>{LABEL_OF[e.kind]}</span>
                  {e.kind === "visit" && e.until ? visitSpan(e.at, e.until) : e.label}
                  {e.target && <span className="text-muted-foreground"> · {e.target}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {presenceNote} 방문의 끝 시각은 마지막으로 기록된 활동이며 최대 {LAST_ACTIVE_INTERVAL_MINUTES}분 늦을 수 있습니다.
        </p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{partialNote}</p>
      </section>
    </div>
  );
}
