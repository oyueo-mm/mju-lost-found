import type { ReactNode } from "react";

import { bucketSpan } from "@/lib/metrics/report";
import { NEW_MEMBER_DAYS, RETURN_WINDOW_DAYS, type UserReport } from "@/lib/metrics/userReport";
import { BarList, GroupedBarChart, StackedBarChart } from "@/components/admin/StatsCharts";
import { AlertIcon, ChevronRightIcon } from "@/components/icons";

// 사용자 통계 tab of /admin/stats: sign-ups, signed-in activity and
// participation, aggregates only (see lib/metrics/userReport.ts for each
// definition). Server-rendered; no client JS.

const fmt = (n: number) => n.toLocaleString("ko-KR");
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "-");
export const DOW_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const UNIT_TEXT = { day: "일별", week: "주별", month: "월별" } as const;

function label(start: string, unit: "day" | "week" | "month") {
  const [, m, d] = start.split("-").map(Number);
  return unit === "month" ? `${start.slice(2, 4)}.${m}` : unit === "week" ? `${m}/${d}~` : `${m}/${d}`;
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

function More({ label: text = "자세히 보기", children }: { label?: string; children: ReactNode }) {
  return (
    <details className="group text-[11px] leading-relaxed text-muted-foreground">
      <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-1 rounded-md font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        {text}
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function Card({ title, value, sub }: { title: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-card p-3">
      <span className="text-xs text-muted-foreground">{title}</span>
      <span className="text-xl font-bold tabular-nums text-foreground">{value}</span>
      {sub && <span className="text-[11px] leading-snug text-muted-foreground">{sub}</span>}
    </div>
  );
}

const Unmeasured = () => <span className="text-lg font-bold text-muted-foreground">미측정</span>;

export function UserStatsView({ report }: { report: UserReport }) {
  const { accounts, signups, activity, hourly, participation: p, range } = report;
  const labels = report.buckets.map((b) => label(bucketSpan(range, b).from, range.unit));
  const trend = report.buckets.length > 1;
  const avgByDow = activity.memberDaysByDow.map((n, i) => (activity.daysByDow[i] ? Math.round((n / activity.daysByDow[i]) * 10) / 10 : 0));
  const ret = activity.retention;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 rounded-card border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        <p>
          <b className="font-semibold text-foreground">가입</b>: 처음 Google 로그인으로 계정이 만들어진 시각(동의·닉네임 완료 전 포함).{" "}
          <b className="font-semibold text-foreground">로그인</b>: Google 로그인을 완료한 횟수(로그인 상태가 유지되는 동안은 다시 세지 않음).{" "}
          <b className="font-semibold text-foreground">활동</b>: 그날 로그인한 상태로 사이트를 이용한 회원(방문 도중 로그인해도 포함, 하루 한 번).
        </p>
        <More label="집계 기준 자세히">
          <ul className="flex list-disc flex-col gap-1 pl-4">
            <li>모든 날짜·시간은 한국 시간(KST)입니다. DB의 UTC 값을 변환해 셉니다.</li>
            <li>가입 완료(동의·닉네임) 시각은 따로 기록되지 않아(재동의 때 덮어씀) 현재 완료 여부만 셉니다.</li>
            <li>활성 회원은 {activity.since}부터 집계되며 그 전은 미측정입니다. 관리자 계정은 활동·참여 지표에서 뺍니다(가입 수에는 포함).</li>
            <li>
              시간대별 로그인 회원 이용량은 각 화면을 볼 때의 로그인 여부로 셉니다(방문 시작 때의 로그인 여부가 아님). 시간대별 지표는 수집 시작 이후만
              있습니다. 시간대별로 &lsquo;서로 다른 회원 수&rsquo;는 저장하지 않으므로 이용량(페이지뷰)으로 봅니다.
            </li>
            <li>
              신규 회원 = 가입한 날부터 {NEW_MEMBER_DAYS}일 이내. 재방문 = 가입한 다음 날부터 {RETURN_WINDOW_DAYS}일 안에 다시 활동. 회원별 연결은 기존
              활동 기록의 비식별값을 서버 안에서 대조해 합계만 냅니다(새 식별자 없음).
            </li>
            <li>회원별 검색 이용은 기록하지 않아(검색은 날짜별 합계만 있음) 신규 회원의 검색 이용률은 제공하지 않습니다.</li>
          </ul>
        </More>
      </div>

      <section className="flex flex-col gap-2" aria-labelledby="user-core">
        <h2 id="user-core" className="text-base font-semibold text-foreground">
          핵심 지표
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Card title="가입 회원 (현재)" value={fmt(accounts.current)} sub={`탈퇴 ${fmt(accounts.withdrawn)} · 누적 ${fmt(accounts.total)}`} />
          <Card title="기간 신규 가입" value={fmt(signups.inRange)} sub={`탈퇴 ${fmt(report.withdrawals.inRange)}`} />
          <Card
            title="기간 활성 회원"
            value={activity.unique === null ? <Unmeasured /> : fmt(activity.unique)}
            sub={activity.coverage === "partial" ? `${activity.since}부터 집계` : "서로 다른 회원 수"}
          />
          <Card title="DAU" value={activity.dau === null ? <Unmeasured /> : fmt(activity.dau)} sub={activity.refDay ? `${activity.refDay} 기준` : undefined} />
          <Card title="WAU" value={activity.wau === null ? <Unmeasured /> : fmt(activity.wau)} sub="기준일 포함 7일" />
          <Card title="MAU" value={activity.mau === null ? <Unmeasured /> : fmt(activity.mau)} sub="기준일 포함 30일" />
        </div>
      </section>

      <Section title="회원가입" description={`가입 기준: 계정이 만들어진 시각(KST) · ${UNIT_TEXT[range.unit]} 집계`}>
        {trend && (
          <div className="grid gap-5 md:grid-cols-2">
            <StackedBarChart
              title="신규 가입"
              labels={labels}
              series={[{ label: "신규 가입", values: signups.perBucket, className: "fill-primary", swatch: "bg-primary" }]}
            />
            <StackedBarChart
              title="누적 가입 (탈퇴 포함, 각 기간 말)"
              labels={labels}
              series={[{ label: "누적 가입", values: signups.cumulative, className: "fill-primary/50", swatch: "bg-primary/50" }]}
            />
          </div>
        )}
        <div className="grid gap-5 md:grid-cols-2">
          <GroupedBarChart
            title="시간대별 가입 (KST, 시)"
            labels={Array.from({ length: 24 }, (_, h) => String(h))}
            tickEvery={3}
            series={[{ label: "가입", values: signups.byHour, className: "fill-primary", swatch: "bg-primary" }]}
          />
          <GroupedBarChart
            title="요일별 가입"
            labels={DOW_LABELS}
            series={[{ label: "가입", values: signups.byDow, className: "fill-primary", swatch: "bg-primary" }]}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          가장 많은 날: {signups.peakDay ? `${signups.peakDay.day} (${fmt(signups.peakDay.n)}명)` : "-"} · 요일:{" "}
          {signups.peakDow ? `${DOW_LABELS[signups.peakDow.dow]} (${fmt(signups.peakDow.n)}명)` : "-"} · 시간대:{" "}
          {signups.peakHour ? `${signups.peakHour.hour}시 (${fmt(signups.peakHour.n)}명)` : "-"}
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card title="동의·닉네임 완료" value={fmt(accounts.onboarded)} sub={`현재 회원의 ${pct(accounts.onboarded, accounts.current)}`} />
          <Card title="동의 미완료·재동의 필요" value={fmt(accounts.notOnboarded)} sub="회원 기능 이용 전" />
          <Card title="이용 정지 중" value={fmt(accounts.suspended)} />
          <Card title="관리자 · 외부 계정" value={`${fmt(accounts.admins)} · ${fmt(accounts.external)}`} sub="가입 수에 포함" />
        </div>
      </Section>

      <Section
        title="로그인 회원 활동"
        description={`활동: 그날 로그인 상태로 사이트를 이용한 회원(하루 한 번) · ${activity.since}부터 집계 · 관리자 제외`}
      >
        {activity.coverage === "none" ? (
          <p className="text-xs text-muted-foreground">미측정 기간입니다.</p>
        ) : (
          <>
            {trend && (
              <StackedBarChart
                title="기간별 활성 회원 (서로 다른 회원 수)"
                labels={labels}
                series={[
                  { label: `신규(가입 ${NEW_MEMBER_DAYS}일 이내)`, values: activity.newPerBucket, className: "fill-primary", swatch: "bg-primary" },
                  { label: "기존 회원", values: activity.existingPerBucket, className: "fill-primary/35", swatch: "bg-primary/35" },
                ]}
              />
            )}
            <div className="grid gap-5 md:grid-cols-2">
              <GroupedBarChart
                title="요일별 하루 평균 활성 회원"
                labels={DOW_LABELS}
                series={[{ label: "평균 활성 회원", values: avgByDow, className: "fill-primary", swatch: "bg-primary" }]}
              />
              <div className="grid grid-cols-2 gap-3">
                <Card
                  title="2일 이상 활동한 회원"
                  value={activity.repeat ? pct(activity.repeat.multiDay, activity.repeat.active) : "-"}
                  sub={activity.repeat ? `${fmt(activity.repeat.multiDay)}명 / 기간 활성 ${fmt(activity.repeat.active)}명` : undefined}
                />
                <Card
                  title={`가입 후 ${RETURN_WINDOW_DAYS}일 내 재방문`}
                  value={ret && ret.eligible ? pct(ret.returned, ret.eligible) : "-"}
                  sub={
                    ret
                      ? ret.eligible
                        ? `${fmt(ret.returned)}명 / 산출 가능 ${fmt(ret.eligible)}명 (제외 ${fmt(ret.excluded)}명: ${RETURN_WINDOW_DAYS}일이 아직 안 지남·활동 기록 전 가입)`
                        : `산출 가능한 가입자 없음 (${RETURN_WINDOW_DAYS}일이 지나야 계산)`
                      : "이 기간 가입자 없음"
                  }
                />
              </div>
            </div>
          </>
        )}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-foreground">시간대별 로그인 회원 이용량 · 로그인 완료 (KST, 시)</h3>
          {hourly.memberPv === null && hourly.logins === null ? (
            <p className="text-xs text-muted-foreground">미측정 기간입니다(이번 업데이트부터 수집).</p>
          ) : (
            <GroupedBarChart
              title=""
              labels={Array.from({ length: 24 }, (_, h) => String(h))}
              tickEvery={3}
              series={[
                { label: "로그인 회원 페이지뷰", values: hourly.memberPv ?? Array(24).fill(null), className: "fill-primary", swatch: "bg-primary" },
                { label: "로그인 완료", values: hourly.logins ?? Array(24).fill(null), className: "fill-primary/35", swatch: "bg-primary/35" },
              ]}
            />
          )}
          <p className="text-[11px] text-muted-foreground">
            페이지뷰: {hourly.memberPvSince ? `${hourly.memberPvSince}부터` : "수집 전"} · 로그인 완료: {hourly.loginSince ? `${hourly.loginSince}부터` : "수집 전"}{" "}
            (그 전은 미측정, 수집 첫날은 일부)
          </p>
        </div>
      </Section>

      <Section title="회원 참여" description="기간 안의 실제 기록을 회원 단위로 대조한 수(합계로 비율을 추정하지 않음) · 관리자 제외">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-foreground">기간 참여 회원</h3>
            <div className="grid grid-cols-2 gap-3">
              <Card title="게시글을 등록한 회원" value={fmt(p.posters)} sub="서로 다른 회원 수" />
              <Card title="채팅 메시지를 보낸 회원" value={fmt(p.chatters)} sub="서로 다른 회원 수" />
            </div>
            {p.activeWithPost !== null && activity.unique ? (
              <p className="text-[11px] text-muted-foreground">
                활성 회원 {fmt(activity.unique)}명 중 게시글 등록 {fmt(p.activeWithPost)}명({pct(p.activeWithPost, activity.unique)}), 채팅{" "}
                {fmt(p.activeWithChat ?? 0)}명({pct(p.activeWithChat ?? 0, activity.unique)})
                {activity.coverage === "partial" ? ` · 활동 기록은 ${activity.since}부터` : ""}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">활동 기록이 없는 기간이라 활성 회원 대비 비율은 미측정입니다.</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-foreground">이 기간 신규 가입 회원 {fmt(p.newSignups)}명의 이후 이용 (조회 시점까지)</h3>
            {p.newSignups === 0 ? (
              <p className="text-xs text-muted-foreground">이 기간 가입자가 없습니다.</p>
            ) : (
              <BarList
                total={p.newSignups}
                rows={[
                  ...(p.newActive === null ? [] : [{ label: "로그인 상태로 활동", value: p.newActive }]),
                  { label: "게시글 등록", value: p.newPosted },
                  { label: "채팅 메시지 보냄", value: p.newChatted },
                ]}
              />
            )}
            {p.newActive === null && p.newSignups > 0 && <p className="text-[11px] text-muted-foreground">활동 여부는 활동 기록 시작({activity.since}) 전 가입자라 미측정입니다.</p>}
          </div>
        </div>
        {report.withdrawals.inRange > 0 && trend && (
          <StackedBarChart
            title="회원 탈퇴"
            labels={labels}
            series={[{ label: "탈퇴", values: report.withdrawals.perBucket, className: "fill-destructive/60", swatch: "bg-destructive/60" }]}
          />
        )}
        <p className="flex gap-2 text-[11px] text-muted-foreground">
          <AlertIcon className="size-3.5 shrink-0" />
          검색은 회원별로 기록하지 않아 회원 단위 검색 이용은 제공하지 않습니다. 탈퇴는 탈퇴 처리 시각(KST) 기준입니다.
        </p>
      </Section>
    </div>
  );
}
