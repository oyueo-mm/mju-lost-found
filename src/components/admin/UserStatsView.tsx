import type { ReactNode } from "react";

import { bucketSpan } from "@/lib/metrics/report";
import { NEW_MEMBER_DAYS, RETURN_WINDOW_DAYS, retentionExclusions, windowNote, type UserReport } from "@/lib/metrics/userReport";
import { BarList, GroupedBarChart, LineChart, StackedBarChart } from "@/components/admin/StatsCharts";
import { More, Section, StatTile, Unmeasured } from "@/components/admin/StatsBlocks";
import { AlertIcon } from "@/components/icons";

// 사용자 통계 tab of /admin/stats: sign-ups, signed-in activity and
// participation, aggregates only (see lib/metrics/userReport.ts for each
// definition). Server-rendered; no client JS.

const fmt = (n: number) => n.toLocaleString("ko-KR");
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "-");
export const DOW_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${h}시`);
const UNIT_TEXT = { day: "일별", week: "주별", month: "월별" } as const;

function label(start: string, unit: "day" | "week" | "month") {
  const [, m, d] = start.split("-").map(Number);
  return unit === "month" ? `${start.slice(2, 4)}.${m}` : unit === "week" ? `${m}/${d}~` : `${m}/${d}`;
}

function Card({ title, value, sub, primary }: { title: string; value: ReactNode; sub?: ReactNode; primary?: boolean }) {
  return <StatTile label={title} value={value} sub={sub} primary={primary} />;
}

export function UserStatsView({ report }: { report: UserReport }) {
  const { accounts, signups, activity, hourly, participation: p, range } = report;
  const labels = report.buckets.map((b) => label(bucketSpan(range, b).from, range.unit));
  const trend = report.buckets.length > 1;
  // a weekday with no measured day in the range is 미측정, not an average of 0
  const avgByDow = activity.memberDaysByDow.map((n, i) => (activity.daysByDow[i] ? Math.round((n / activity.daysByDow[i]) * 10) / 10 : null));
  // the last period runs to today, so its count is still growing
  const inProgress = range.until > report.today;
  const ret = activity.retention;
  const retValue = !ret ? "-" : ret.eligible ? pct(ret.returned, ret.eligible) : ret.pending ? <Unmeasured text="집계 대기" /> : <Unmeasured />;
  const unmeasuredWhy = activity.expiredInRange
    ? `${activity.since}부터 기록했고, ${activity.retainedFrom} 이전 기록은 보관기한(400일)이 지나 삭제되었을 수 있어 미측정입니다(0명이 아님).`
    : `${activity.since}부터 기록해 그 전은 미측정입니다(0명이 아님).`;

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
            <li>
              회원 수: 누적 가입 = 현재 가입 + 탈퇴. 현재 가입 = 이용 가능 + 비활성화(비활성화는 다시 로그인하면 복구되므로 탈퇴가 아님). 동의·닉네임 완료,
              관리자, 이용 정지, 외부 계정은 이용 가능 회원 중의 수입니다.
            </li>
            <li>가입 완료(동의·닉네임) 시각은 따로 기록되지 않아(재동의 때 덮어씀) 현재 완료 여부만 셉니다.</li>
            <li>
              활성 회원은 {activity.since}부터 기록되며 그 전은 미측정입니다. 활동 기록은 400일 뒤 삭제되므로 그보다 오래된 날짜도 미측정입니다(0명이
              아님). 관리자 계정은 활동·참여 지표에서 뺍니다(가입 수에는 포함).
            </li>
            <li>
              시간대별 로그인 회원 이용량은 각 화면을 볼 때의 로그인 여부로 셉니다(방문 시작 때의 로그인 여부가 아님). 시간대별 지표는 이 환경에서 수집을
              시작한 뒤만 있고, 그 뒤 기록이 없는 시간은 0건입니다. 시간대별로 &lsquo;서로 다른 회원 수&rsquo;는 저장하지 않으므로 이용량(페이지뷰)으로
              봅니다.
            </li>
            <li>
              대상 범위 차이: 페이지뷰에는 동의 미완료·이용 정지 회원이 본 동의·안내 화면도 들어가지만, 활성 회원은 동의·닉네임을 마치고 정지되지 않은
              회원만 셉니다. &lsquo;내 방문 통계에서 제외&rsquo;를 켠 브라우저의 회원 페이지뷰는 빠지지만 그 회원의 활동 일자는 기록됩니다.
            </li>
            <li>
              신규 회원 = 가입한 날부터 {NEW_MEMBER_DAYS}일 이내. 재방문 = 가입한 다음 날부터 {RETURN_WINDOW_DAYS}일 안에 다시 활동. 회원별 연결은 기존
              활동 기록의 비식별값을 서버 안에서 대조해 합계만 냅니다(새 식별자 없음).
            </li>
            <li>회원별 검색 이용은 기록하지 않아(검색은 날짜별 합계만 있음) 신규 회원의 검색 이용률은 제공하지 않습니다.</li>
            <li>
              회원이 탈퇴하면 그 회원의 활동 기록이 삭제되므로, 이미 지난 기간의 활성 회원 수·DAU·WAU·MAU·재방문 수도 그만큼 줄어들 수
              있습니다. 탈퇴한 가입자는 재방문 산출에서 &lsquo;탈퇴&rsquo;로 따로 빼며 재방문하지 않은 것으로 세지 않습니다. 시간대별
              로그인·페이지뷰 합계는 회원 정보가 없어 탈퇴와 관계없이 남습니다.
            </li>
          </ul>
        </More>
      </div>

      <section className="flex flex-col gap-2" aria-labelledby="user-core">
        <h2 id="user-core" className="text-base font-semibold text-foreground">
          핵심 지표
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Card
            primary
            title="가입 회원 (현재)"
            value={fmt(accounts.current)}
            sub={`이용 가능 ${fmt(accounts.available)} · 비활성화 ${fmt(accounts.deactivated)} · 탈퇴 ${fmt(accounts.withdrawn)} · 누적 ${fmt(accounts.total)}`}
          />
          <Card primary title="기간 신규 가입" value={fmt(signups.inRange)} sub={`탈퇴 ${fmt(report.withdrawals.inRange)}`} />
          <Card
            primary
            title="기간 활성 회원"
            value={activity.unique === null ? <Unmeasured /> : fmt(activity.unique)}
            sub={activity.coverage === "partial" ? `부분 측정 · ${activity.expiredInRange ? `${activity.retainedFrom} 이전 삭제` : `${activity.since}부터 기록`}` : "서로 다른 회원 수"}
          />
          <Card primary title="DAU" value={activity.dau === null ? <Unmeasured /> : fmt(activity.dau)} sub={windowNote(activity.windows.dau, 1, activity)} />
          <Card primary title="WAU" value={activity.wau === null ? <Unmeasured /> : fmt(activity.wau)} sub={windowNote(activity.windows.wau, 7, activity)} />
          <Card primary title="MAU" value={activity.mau === null ? <Unmeasured /> : fmt(activity.mau)} sub={windowNote(activity.windows.mau, 30, activity)} />
        </div>
      </section>

      <Section title="회원가입" description={`가입 기준: 계정이 만들어진 시각(KST) · ${UNIT_TEXT[range.unit]} 집계`}>
        {trend && (
          <div className="grid gap-5 md:grid-cols-2">
            <StackedBarChart
              title={`${UNIT_TEXT[range.unit]} 신규 가입`}
              unit="명"
              labels={labels}
              inProgress={inProgress}
              series={[{ label: "신규 가입", values: signups.perBucket, tone: 1 }]}
            />
            <LineChart
              title="누적 가입 (탈퇴 포함, 각 기간 말 기준)"
              unit="명"
              labels={labels}
              inProgress={inProgress}
              series={[{ label: "누적 가입", values: signups.cumulative, tone: 1 }]}
            />
          </div>
        )}
        <div className="grid gap-5 md:grid-cols-2">
          <GroupedBarChart
            title="시간대별 가입 (KST, 기간 합계)"
            unit="명"
            labels={HOUR_LABELS}
            tickEvery={3}
            series={[{ label: "가입", values: signups.byHour, tone: 1 }]}
          />
          <GroupedBarChart
            title="요일별 가입 (기간 합계)"
            unit="명"
            labels={DOW_LABELS}
            series={[{ label: "가입", values: signups.byDow, tone: 1 }]}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          가장 많은 날: {signups.peakDay ? `${signups.peakDay.day} (${fmt(signups.peakDay.n)}명)` : "-"} · 요일:{" "}
          {signups.peakDow ? `${DOW_LABELS[signups.peakDow.dow]} (${fmt(signups.peakDow.n)}명)` : "-"} · 시간대:{" "}
          {signups.peakHour ? `${signups.peakHour.hour}시 (${fmt(signups.peakHour.n)}명)` : "-"}
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5 max-md:[&>*:last-child]:col-span-2">
          <Card title="동의·닉네임 완료" value={fmt(accounts.onboarded)} sub={`이용 가능 회원의 ${pct(accounts.onboarded, accounts.available)}`} />
          <Card title="동의 미완료·재동의 필요" value={fmt(accounts.notOnboarded)} sub="회원 기능 이용 전" />
          <Card title="비활성화" value={fmt(accounts.deactivated)} sub="로그인 불가 · 다시 로그인하면 복구(탈퇴 아님)" />
          <Card title="이용 정지 중" value={fmt(accounts.suspended)} />
          <Card title="관리자 · 외부 계정" value={`${fmt(accounts.admins)} · ${fmt(accounts.external)}`} sub="가입 수에 포함" />
        </div>
      </Section>

      <Section
        title="로그인 회원 활동"
        description={`활동: 그날 로그인 상태로 사이트를 이용한 회원(하루 한 번) · ${activity.since}부터 집계 · 관리자 제외 · 탈퇴한 회원의 기록은 삭제되어 지난 기간 수치도 줄어들 수 있음`}
      >
        {activity.coverage === "none" ? (
          <p className="text-xs text-muted-foreground">미측정 기간입니다. {unmeasuredWhy}</p>
        ) : (
          <>
            {activity.coverage === "partial" && <p className="text-[11px] text-muted-foreground">부분 측정: {unmeasuredWhy}</p>}
            {trend && (
              <StackedBarChart
                title={`${UNIT_TEXT[range.unit]} 활성 회원 (서로 다른 회원 수)`}
                unit="명"
                labels={labels}
                coverage={activity.perBucketCoverage}
                inProgress={inProgress}
                series={[
                  { label: "기존 회원", values: activity.existingPerBucket, tone: 1 },
                  { label: `신규(가입 ${NEW_MEMBER_DAYS}일 이내)`, values: activity.newPerBucket, tone: 3 },
                ]}
              />
            )}
            <div className="grid gap-5 md:grid-cols-2">
              <GroupedBarChart
                title="요일별 하루 평균 활성 회원"
                unit="명"
                labels={DOW_LABELS}
                series={[{ label: "평균 활성 회원", values: avgByDow, tone: 1 }]}
              />
              <div className="grid grid-cols-2 gap-3">
                <Card
                  title="2일 이상 활동한 회원"
                  value={activity.repeat ? pct(activity.repeat.multiDay, activity.repeat.active) : "-"}
                  sub={activity.repeat ? `${fmt(activity.repeat.multiDay)}명 / 기간 활성 ${fmt(activity.repeat.active)}명` : undefined}
                />
                <Card
                  title={`가입 후 ${RETURN_WINDOW_DAYS}일 내 재방문`}
                  value={retValue}
                  sub={
                    ret ? (
                      <>
                        {ret.eligible ? `${fmt(ret.returned)}명 / 산출 가능 ${fmt(ret.eligible)}명` : "산출 가능한 가입자 없음"} (기간 가입 {fmt(ret.cohort)}명)
                        {retentionExclusions(ret).map((t) => (
                          <span key={t} className="block">
                            제외: {t}
                          </span>
                        ))}
                      </>
                    ) : (
                      "이 기간 가입자 없음"
                    )
                  }
                />
              </div>
            </div>
          </>
        )}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-foreground">세 지표의 차이 (이 기간)</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card
              title="고유 활성 회원"
              value={activity.unique === null ? <Unmeasured /> : `${fmt(activity.unique)}명`}
              sub="사람 수: 로그인 상태로 이용한 회원을 기간 안에서 한 번만 셈"
            />
            <Card
              title="로그인 완료"
              value={hourly.loginTotal === null ? <Unmeasured /> : `${fmt(hourly.loginTotal)}회`}
              sub="횟수: Google 로그인을 새로 마친 수(로그인 유지 중 방문은 세지 않음)"
            />
            <Card
              title="로그인 회원 페이지뷰"
              value={hourly.memberPvTotal === null ? <Unmeasured /> : `${fmt(hourly.memberPvTotal)}회`}
              sub="이용량: 로그인 상태에서 본 화면 수(한 회원이 여러 번)"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-foreground">시간대별 로그인 회원 이용량 · 로그인 완료 (KST, 기간 합계)</h3>
          {hourly.memberPv === null && hourly.logins === null ? (
            <p className="text-xs text-muted-foreground">
              미측정 기간입니다({hourly.memberPvSince || hourly.loginSince ? `이 환경의 수집 시작: ${hourly.memberPvSince ?? hourly.loginSince}` : "이 환경에서 아직 수집 전"}).
            </p>
          ) : (
            // Two charts, not one: page views run far above sign-ins, and on
            // a shared axis the sign-in bars would flatten to nothing.
            <div className="grid gap-5 md:grid-cols-2">
              <GroupedBarChart
                title="로그인 회원 페이지뷰"
                unit="회"
                labels={HOUR_LABELS}
                tickEvery={3}
                series={[{ label: "로그인 회원 페이지뷰", values: hourly.memberPv ?? Array(24).fill(null), tone: 1 }]}
              />
              <GroupedBarChart
                title="로그인 완료"
                unit="회"
                labels={HOUR_LABELS}
                tickEvery={3}
                series={[{ label: "로그인 완료", values: hourly.logins ?? Array(24).fill(null), tone: 2 }]}
              />
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            페이지뷰: {hourly.memberPvSince ? `${hourly.memberPvSince}부터` : "수집 전"} · 로그인 완료: {hourly.loginSince ? `${hourly.loginSince}부터` : "수집 전"}{" "}
            (이 환경의 수집 시작 기준. 그 전은 미측정, 그 뒤 기록이 없으면 0건. 시작 시각이 없는 날짜는 그날 일부만 수집)
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
                unit="명"
                total={p.newSignups}
                rows={[
                  ...(p.newActive === null ? [] : [{ label: "로그인 상태로 활동", value: p.newActive }]),
                  { label: "게시글 등록", value: p.newPosted },
                  { label: "채팅 메시지 보냄", value: p.newChatted },
                ]}
              />
            )}
            {p.newActive === null && p.newSignups > 0 && <p className="text-[11px] text-muted-foreground">활동 여부는 활동 기록 시작({activity.since}) 전 가입자라 미측정입니다.</p>}
            {p.newWithdrawn > 0 && (
              <p className="text-[11px] text-muted-foreground">
                이 중 {fmt(p.newWithdrawn)}명은 탈퇴해 활동 기록이 삭제되어 활동 여부에 반영되지 않습니다.
              </p>
            )}
            {p.newActive !== null && p.newBeforeCollection > 0 && (
              <p className="text-[11px] text-muted-foreground">
                이 중 {fmt(p.newBeforeCollection)}명은 활동 기록 시작({activity.since}) 전에 가입해 그 전 활동은 반영되지 않습니다.
              </p>
            )}
          </div>
        </div>
        {report.withdrawals.inRange > 0 && trend && (
          <StackedBarChart
            title={`${UNIT_TEXT[range.unit]} 회원 탈퇴`}
            unit="명"
            labels={labels}
            inProgress={inProgress}
            series={[{ label: "탈퇴", values: report.withdrawals.perBucket, tone: 2 }]}
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
