import { BarList, StackedBarChart, type ChartTone } from "@/components/admin/StatsCharts";
import { More, SubHeading } from "@/components/admin/StatsBlocks";
import { UtmLinkBuilder } from "@/components/admin/UtmLinkBuilder";
import { AlertIcon } from "@/components/icons";
import type { InflowReport } from "@/lib/metrics/inflow";
import { sinceLabel } from "@/lib/metrics/report";
import { PAGE_KIND_LABELS, type SiteKey } from "@/lib/metrics/visits";

// 유입 경로 (날짜별 방문 분석, the same chosen days): visit sessions by
// source, login state and first screen. Server only; every number comes
// from lib/metrics/inflow.ts, the same report the export writes.

const fmt = (n: number) => n.toLocaleString("ko-KR");
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "-");
const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const TONES: ChartTone[] = [1, 2, 3, 5, 6];

export function InflowView({ report }: { report: InflowReport }) {
  const n = report.days.length;
  const { total } = report;
  const unmeasured = n - report.measuredDays;
  const mismatches = report.perDay.filter((d) => d.mismatch);
  const fullDays = report.perDay.filter((d) => d.coverage === "full" && d.sessions);
  const sessionsOfFull = fullDays.reduce((a, d) => a + d.sessions!.anon + d.sessions!.member, 0);
  const sourcesOfFull = fullDays.reduce((a, d) => a + (d.bySource?.anon ?? 0) + (d.bySource?.member ?? 0), 0);
  const top = report.sites.slice(0, TONES.length);
  const rest = report.sites.slice(TONES.length);
  const topEntrySites: SiteKey[] = report.sites.slice(0, 3).map((s) => s.site);

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">유입 경로</h3>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          고른 {n}일의 방문 세션이 어디서 들어왔는지입니다. 세션마다 첫 화면에서 한 번만 세며(화면 이동·새로고침은 다시 세지 않음), 유효한 UTM이 있으면 그
          출처를, 없으면 리퍼러 도메인 분류를 씁니다. 관리자·자동화 브라우저의 방문은 빠집니다.
          {report.since ? ` 이 환경의 수집 시작: ${report.since}(그날은 부분 측정).` : " 이 환경에서는 아직 수집 전입니다."}
          {unmeasured > 0 && ` 고른 날 중 ${unmeasured}일은 미측정입니다.`}
        </p>
      </div>

      {report.measuredDays === 0 ? (
        <p className="rounded-card border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          고른 날짜는 모두 유입 경로 수집 전이라 <b className="font-semibold text-foreground">미측정</b>입니다(0건이 아님). 아래 기존 리퍼러 분류는 볼 수 있습니다.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Figure label="유입 집계 방문 세션" value={`${fmt(total.all)}회`} sub={`측정 ${report.measuredDays}일`} />
            <Figure label="로그인 상태로 시작" value={`${fmt(total.member)}회`} sub={pct(total.member, total.all)} />
            <Figure label="비로그인으로 시작" value={`${fmt(total.anon)}회`} sub={pct(total.anon, total.all)} />
            <Figure label="출처 확인 불가" value={`${fmt(report.sites.find((s) => s.site === "unknown")?.total ?? 0)}회`} sub="리퍼러 없음: 직접 입력·북마크·앱 안 브라우저 등" />
          </div>
          {fullDays.length > 0 && (
            <p className={`flex gap-2 text-[11px] ${mismatches.length ? "text-destructive" : "text-muted-foreground"}`}>
              {mismatches.length > 0 && <AlertIcon className="mt-0.5 size-3.5 shrink-0" />}
              <span>
                검증: 완전히 측정된 {fullDays.length}일의 유입 세션 합 {fmt(sourcesOfFull)}회 = 방문 세션 {fmt(sessionsOfFull)}회
                {mismatches.length ? ` — 불일치 ${mismatches.map((d) => md(d.day)).join(", ")} (보고 누락·중복 가능, 원시 값은 내보내기에 있음)` : " (일치)"}
              </span>
            </p>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <SubHeading basis="방문 세션 · 비율은 유입 집계 세션 대비">유입 출처 순위</SubHeading>
              <BarList
                total={total.all}
                unit="회"
                rows={report.sites.map((s) => ({ label: s.label, value: s.total, note: [s.viaUtm && `UTM ${fmt(s.viaUtm)}`, s.viaRef && `리퍼러 ${fmt(s.viaRef)}`].filter(Boolean).join(" · ") }))}
                empty="이 날짜에 기록된 방문이 없습니다(0회)."
              />
            </div>
            <div className="flex flex-col gap-2">
              <SubHeading basis="방문 세션 · 첫 화면">최초 진입 화면</SubHeading>
              <BarList
                total={total.all}
                unit="회"
                rows={report.entries.map((e) => ({ label: PAGE_KIND_LABELS[e.kind], value: e.total }))}
                empty="이 날짜에 기록된 방문이 없습니다(0회)."
              />
            </div>
          </div>

          {n > 1 && report.sites.length > 0 && (
            <StackedBarChart
              title="날짜별 유입 출처"
              unit="회"
              labels={report.days.map(md)}
              coverage={report.perDay.map((d) => d.coverage)}
              series={[
                ...top.map((s, i) => ({ label: s.label, values: s.byDay.map((v, d) => (report.perDay[d].coverage === "none" ? null : v)), tone: TONES[i] })),
                ...(rest.length
                  ? [{ label: "그 밖의 출처", values: report.days.map((_, d) => (report.perDay[d].coverage === "none" ? null : rest.reduce((a, s) => a + s.byDay[d], 0))), tone: 4 as ChartTone }]
                  : []),
              ]}
            />
          )}

          <div className="flex flex-col gap-2">
            <SubHeading basis="방문 세션">출처별 상세 · 로그인 비교</SubHeading>
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[40rem] text-right text-xs tabular-nums">
                <caption className="sr-only">유입 출처별 방문 세션, 로그인 여부와 UTM·리퍼러 구분</caption>
                <thead className="text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1.5 pr-2 text-left font-medium">출처</th>
                    <th scope="col" className="py-1.5 pr-2 font-medium">방문 세션</th>
                    <th scope="col" className="py-1.5 pr-2 font-medium">비율</th>
                    <th scope="col" className="py-1.5 pr-2 font-medium">로그인</th>
                    <th scope="col" className="py-1.5 pr-2 font-medium">비로그인</th>
                    <th scope="col" className="py-1.5 pr-2 font-medium">UTM</th>
                    <th scope="col" className="py-1.5 pr-2 font-medium">리퍼러</th>
                  </tr>
                </thead>
                <tbody>
                  {report.sites.map((s) => (
                    <tr key={s.site} className="border-t border-border text-foreground">
                      <th scope="row" className="py-1.5 pr-2 text-left font-medium">{s.label}</th>
                      <td className="py-1.5 pr-2 font-semibold">{fmt(s.total)}</td>
                      <td className="py-1.5 pr-2">{pct(s.total, total.all)}</td>
                      <td className="py-1.5 pr-2">{fmt(s.member)}</td>
                      <td className="py-1.5 pr-2">{fmt(s.anon)}</td>
                      <td className="py-1.5 pr-2">{fmt(s.viaUtm)}</td>
                      <td className="py-1.5 pr-2">{fmt(s.viaRef)}</td>
                    </tr>
                  ))}
                </tbody>
                {report.sites.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border font-semibold text-foreground">
                      <th scope="row" className="py-1.5 pr-2 text-left">합계</th>
                      <td className="py-1.5 pr-2">{fmt(total.all)}</td>
                      <td className="py-1.5 pr-2">100%</td>
                      <td className="py-1.5 pr-2">{fmt(total.member)}</td>
                      <td className="py-1.5 pr-2">{fmt(total.anon)}</td>
                      <td className="py-1.5 pr-2">{fmt(report.sites.reduce((a, s) => a + s.viaUtm, 0))}</td>
                      <td className="py-1.5 pr-2">{fmt(report.sites.reduce((a, s) => a + s.viaRef, 0))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <More label="진입 화면 × 출처, UTM 값별 표">
            <div className="flex flex-col gap-4">
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[32rem] text-right text-xs tabular-nums">
                  <caption className="sr-only">최초 진입 화면별 방문 세션과 주요 출처</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="py-1 pr-2 text-left font-medium">첫 화면</th>
                      <th scope="col" className="py-1 pr-2 font-medium">방문 세션</th>
                      {topEntrySites.map((s) => (
                        <th key={s} scope="col" className="py-1 pr-2 font-medium">
                          {report.sites.find((x) => x.site === s)?.label}
                        </th>
                      ))}
                      <th scope="col" className="py-1 pr-2 font-medium">그 밖의 출처</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.entries.map((e) => {
                      const shown = topEntrySites.reduce((a, s) => a + (e.bySite[s] ?? 0), 0);
                      return (
                        <tr key={e.kind} className="border-t border-border text-foreground">
                          <th scope="row" className="py-1 pr-2 text-left font-medium">{PAGE_KIND_LABELS[e.kind]}</th>
                          <td className="py-1 pr-2 font-semibold">{fmt(e.total)}</td>
                          {topEntrySites.map((s) => (
                            <td key={s} className="py-1 pr-2">{fmt(e.bySite[s] ?? 0)}</td>
                          ))}
                          <td className="py-1 pr-2">{fmt(e.total - shown)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {(
                  [
                    ["utm_source (출처)", report.utm.source],
                    ["utm_medium (매체)", report.utm.medium],
                    ["utm_campaign (캠페인)", report.utm.campaign],
                  ] as const
                ).map(([title, list]) => (
                  <div key={title} className="flex flex-col gap-1.5">
                    <p className="text-[11px] font-semibold text-foreground">{title}</p>
                    <BarList rows={list.map((r) => ({ label: r.value, value: r.sessions }))} unit="회" empty="이 태그가 붙은 방문이 없습니다." />
                  </div>
                ))}
              </div>
              <p className="text-[11px]">하루에 서로 다른 값이 30개를 넘으면 그 뒤 값은 etc로 묶습니다. utm_medium은 유입 경로 수집 시작일부터 셉니다.</p>
            </div>
          </More>
        </>
      )}

      <More label={`기존 리퍼러 분류 보기 (${sinceLabel("visit")}부터 · 로그인 구분·UTM 우선 없음, ${report.legacyDays}일)`}>
        <BarList
          rows={report.legacyRefs.map((r) => ({ label: r.label, value: r.sessions }))}
          unit="회"
          empty={report.legacyDays ? "기록이 없습니다(0회)." : "고른 날짜는 방문 통계 수집 전(미측정)입니다."}
        />
        <p className="mt-1 text-[11px]">유입 경로 수집 전 날짜도 포함하는 이전 방식의 집계로, 위 유입 출처와 더하거나 섞지 마세요.</p>
      </More>

      <More label="홍보 링크 만들기 (UTM)">
        <UtmLinkBuilder />
      </More>
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-card border border-border/80 bg-muted/30 p-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-xl font-bold text-foreground tabular-nums">{value}</span>
      <span className="text-[11px] leading-snug text-muted-foreground">{sub}</span>
    </div>
  );
}
