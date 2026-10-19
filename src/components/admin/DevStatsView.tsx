import Link from "next/link";

import { DAY_TONES, Sparkline, StackedBarChart, type ChartTone } from "@/components/admin/StatsCharts";
import { More, Section, StatTile, SubHeading } from "@/components/admin/StatsBlocks";
import { AlertIcon } from "@/components/icons";
import { addDays } from "@/lib/metrics/daySelection";
import { GITHUB_REPO, MAX_COMMITS, REPO_URL, REVALIDATE_SECONDS, type CommitFeed, type DevCommit } from "@/lib/devstats/github";
import { DEV_PERIODS, kstDayOf, kstTimeOf, type DevReport, type DevUnit } from "@/lib/devstats/stats";

// 개발자 통계 (/admin/stats?tab=dev): the repository's commits from GitHub
// (lib/devstats). Read-only; every link goes to the commit or the
// account on GitHub. Filters live in the URL: dp (period), da (developer),
// du (unit), dn (timeline length).

const fmt = (n: number) => n.toLocaleString("ko-KR");
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const dayTitle = (day: string) => `${day.slice(0, 4)}년 ${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일 (${DOW[new Date(`${day}T00:00:00Z`).getUTCDay()]})`;
const kstStamp = (iso: string) => `${kstDayOf(iso)} ${kstTimeOf(iso)}`;
const bucketLabel = (b: string, unit: DevUnit) => (unit === "month" ? `${b.slice(2, 4)}.${Number(b.slice(5, 7))}` : unit === "week" ? `${md(b)}~` : md(b));
const UNIT_TEXT: Record<DevUnit, string> = { day: "일별", week: "주별", month: "월별" };
export const TIMELINE_STEP = 40;
const external = { target: "_blank", rel: "noopener noreferrer" } as const;

export type DevOptions = { period: DevReport["period"]; unit: DevUnit | null; author: string | null; limit: number };

function hrefOf(o: DevOptions, patch: Partial<DevOptions>, hash = "") {
  const s = { ...o, ...patch };
  const q = new URLSearchParams({ tab: "dev", dp: s.period });
  if (s.unit) q.set("du", s.unit);
  if (s.author) q.set("da", s.author);
  if (s.limit !== TIMELINE_STEP) q.set("dn", String(s.limit));
  return `/admin/stats?${q.toString()}${hash}`;
}

function Segmented({ items, label }: { items: { href: string; text: string; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="inline-flex flex-wrap self-start rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
      {items.map((i) => (
        <Link
          key={i.text}
          href={i.href}
          aria-current={i.active ? "true" : undefined}
          scroll={false}
          className={`rounded-md px-2.5 py-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${i.active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
        >
          {i.text}
        </Link>
      ))}
    </nav>
  );
}

// A developer's colour follows the all-time order, so it never changes
// with the filter or the period.
function toneMap(report: DevReport): Map<string, ChartTone> {
  const byFirst = [...report.authors].sort((a, b) => b.allTime - a.allTime || a.key.localeCompare(b.key));
  return new Map(byFirst.map((a, i) => [a.key, DAY_TONES[i % DAY_TONES.length]]));
}

const HEAT = [18, 34, 52, 72, 92];
const heatStyle = (v: number, max: number) => ({
  backgroundColor: `color-mix(in srgb, var(--chart-3) ${HEAT[Math.min(HEAT.length - 1, Math.max(0, Math.ceil((v / Math.max(1, max)) * HEAT.length) - 1))]}%, transparent)`,
});

// GitHub-style activity grid: one column per week (Monday first), one
// square per KST day.
function CommitHeatmap({ report }: { report: DevReport }) {
  const { from, to, counts, max } = report.heat;
  const weeks: string[][] = [];
  for (let d = from; d <= to; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  const total = Object.values(counts).reduce((a, n) => a + n, 0);
  const activeDays = Object.keys(counts).length;
  const busiest = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];
  const summary = `${from} ~ ${to} 커밋 히트맵: ${fmt(total)}건, 커밋한 날 ${fmt(activeDays)}일${busiest ? `, 가장 많은 날 ${busiest[0]} ${busiest[1]}건` : ""}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-x-auto pb-1">
        <div role="img" aria-label={summary} className="inline-flex flex-col gap-1">
          <div className="flex gap-[3px] pl-6 text-[10px] text-muted-foreground" aria-hidden>
            {weeks.map((w) => {
              const first = w.find((d) => d.endsWith("-01") || d === from);
              return (
                <span key={w[0]} className="w-3 shrink-0 overflow-visible whitespace-nowrap">
                  {first && (first === from || first.endsWith("-01")) ? `${Number(first.slice(5, 7))}월` : ""}
                </span>
              );
            })}
          </div>
          <div className="flex gap-[3px]" aria-hidden>
            <div className="flex w-5 shrink-0 flex-col gap-[3px] text-[9px] leading-3 text-muted-foreground">
              {["월", "", "수", "", "금", "", "일"].map((t, i) => (
                <span key={i} className="h-3">
                  {t}
                </span>
              ))}
            </div>
            {weeks.map((w) => (
              <div key={w[0]} className="flex shrink-0 flex-col gap-[3px]">
                {w.map((d) => {
                  if (d > to) return <span key={d} className="size-3" />;
                  const n = counts[d] ?? 0;
                  return (
                    <span
                      key={d}
                      title={`${d}: 커밋 ${n}건`}
                      className={`size-3 rounded-[3px] ${n === 0 ? "bg-muted" : ""} ${d === to ? "ring-1 ring-foreground/40" : ""}`}
                      style={n > 0 ? heatStyle(n, max) : undefined}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-hidden>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-[3px] bg-muted" /> 커밋 없음
        </span>
        <span className="flex items-center gap-1">
          적음
          {HEAT.map((p) => (
            <span key={p} className="inline-block size-2.5 rounded-[3px]" style={{ backgroundColor: `color-mix(in srgb, var(--chart-3) ${p}%, transparent)` }} />
          ))}
          많음
        </span>
        <span>테두리 = 오늘</span>
      </div>
    </div>
  );
}

function AuthorName({ login, name, profileUrl }: { login: string | null; name: string; profileUrl: string | null }) {
  if (login && profileUrl)
    return (
      <a href={profileUrl} {...external} className="font-medium text-foreground hover:text-primary hover:underline">
        {login}
      </a>
    );
  return <span className="font-medium text-foreground">{name}</span>;
}

function CommitItem({ c, tone }: { c: DevCommit; tone: ChartTone | undefined }) {
  return (
    <li className="relative flex gap-3 pb-4 pl-5 last:pb-0">
      <span aria-hidden className="absolute top-1.5 left-0 size-2.5 rounded-full" style={{ backgroundColor: `var(--chart-${tone ?? 4})` }} />
      <span aria-hidden className="absolute top-4 bottom-0 left-[4.5px] w-px bg-border" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <a href={c.url} {...external} className="text-sm leading-snug font-medium [overflow-wrap:anywhere] text-foreground hover:text-primary hover:underline">
          {c.title}
        </a>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          <time dateTime={c.authoredAt}>{kstTimeOf(c.authoredAt)}</time>
          <AuthorName login={c.author.login} name={c.author.name} profileUrl={c.author.profileUrl} />
          <a href={c.url} {...external} className="font-mono hover:text-primary hover:underline">
            {c.sha.slice(0, 7)}
          </a>
          {c.merge && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium">병합</span>}
          {c.coAuthors.length > 0 && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px]" title="커밋 메시지의 Co-Authored-By 표시">
              공동 작성: {c.coAuthors.join(", ")}
            </span>
          )}
        </p>
        {c.body && (
          <details className="group text-[11px] text-muted-foreground">
            <summary className="w-fit cursor-pointer list-none font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              메시지 전체 보기
            </summary>
            <p className="mt-1 leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{c.body}</p>
          </details>
        )}
      </div>
    </li>
  );
}

function FeedError({ feed }: { feed: Extract<CommitFeed, { ok: false }> }) {
  const text =
    feed.reason === "rate_limited"
      ? `GitHub API 요청 한도에 도달했습니다.${feed.resetAt ? ` ${kstStamp(feed.resetAt)}(KST) 이후` : " 잠시 후"} 다시 불러옵니다.`
      : feed.reason === "not_found"
        ? "GitHub 저장소나 브랜치를 찾을 수 없습니다(이름 변경·비공개 전환 여부를 확인해 주세요)."
        : "GitHub에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  return (
    <div role="alert" className="flex gap-2 rounded-card border border-warning/50 bg-warning-muted px-3 py-2 text-xs leading-relaxed text-foreground">
      <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
      <div>
        <p className="font-semibold">개발자 통계를 불러오지 못했습니다.</p>
        <p>{text} 다른 운영 통계와 서비스 기능에는 영향이 없습니다.</p>
      </div>
    </div>
  );
}

export function DevStatsView({ feed, report, options }: { feed: CommitFeed; report: DevReport | null; options: DevOptions }) {
  const source = (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      출처:{" "}
      <a href={REPO_URL} {...external} className="font-medium text-primary hover:underline">
        {GITHUB_REPO.owner}/{GITHUB_REPO.repo}
      </a>{" "}
      · <span className="font-mono">{GITHUB_REPO.branch}</span> 브랜치 · GitHub API
      {feed.ok ? ` · ${kstStamp(feed.fetchedAt)} 기준(최대 ${REVALIDATE_SECONDS / 60}분 간격으로 갱신)` : ""}
    </p>
  );
  if (!feed.ok || !report)
    return (
      <div className="flex flex-col gap-3">
        {source}
        {!feed.ok && <FeedError feed={feed} />}
      </div>
    );

  const tones = toneMap(report);
  const period = DEV_PERIODS.find((p) => p.key === report.period)!;
  const periodText = `${report.from} ~ ${report.to}`;
  const filtered = report.author ? report.authors.find((a) => a.key === report.author) : null;
  const visible = report.commits.slice(0, options.limit);
  const groups: { day: string; commits: DevCommit[] }[] = [];
  for (const c of visible) {
    const day = kstDayOf(c.authoredAt);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.commits.push(c);
    else groups.push({ day, commits: [c] });
  }
  const last = report.totals.lastCommit;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {source}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <Segmented label="기간" items={DEV_PERIODS.map((p) => ({ href: hrefOf(options, { period: p.key, unit: null, limit: TIMELINE_STEP }), text: p.label, active: p.key === report.period }))} />
          <Segmented
            label="개발자"
            items={[
              { href: hrefOf(options, { author: null, limit: TIMELINE_STEP }), text: "전체 개발자", active: !report.author },
              ...report.authors.map((a) => ({ href: hrefOf(options, { author: a.key, limit: TIMELINE_STEP }), text: a.login ?? a.name, active: a.key === report.author })),
            ]}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {period.label} ({periodText}){filtered ? ` · ${filtered.login ?? filtered.name}` : ""} · 한국 시간 기준(커밋 작성 시각)
          {feed.truncated ? ` · 최근 커밋 ${fmt(MAX_COMMITS)}개까지만 반영` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile primary label="커밋" value={`${fmt(report.totals.commits)}건`} sub={report.totals.merges ? `병합 커밋 ${fmt(report.totals.merges)}건 포함` : "병합 커밋 없음"} />
        <StatTile primary label="커밋한 날" value={`${fmt(report.totals.activeDays)}일`} sub={`${period.label} 중`} />
        <StatTile primary label="참여 개발자" value={`${fmt(report.totals.authors)}명`} sub="커밋 작성자 기준" />
        <StatTile
          primary
          label="최근 커밋"
          value={last ? kstDayOf(last.authoredAt).slice(5).replace("-", "/") : "-"}
          sub={last ? `${kstTimeOf(last.authoredAt)} · ${last.author.login ?? last.author.name}` : "이 기간에 커밋 없음"}
        />
      </div>

      <Section
        title="커밋 추이"
        description={
          <>
            <p>기간 안의 커밋 수를 {UNIT_TEXT[report.unit]}로 개발자별로 쌓아 보여 줍니다.</p>
            <More label="집계 기준">
              <ul className="flex list-disc flex-col gap-1 pl-4">
                <li>
                  <span className="font-mono">{GITHUB_REPO.branch}</span> 브랜치에 들어간 커밋만 셉니다(다른 브랜치·PR에만 있는 커밋, 아직 push하지 않은 커밋 제외).
                </li>
                <li>날짜는 커밋을 작성한 시각(author date)의 한국 날짜입니다. rebase 등으로 반영 시각과 다를 수 있습니다.</li>
                <li>
                  개발자는 GitHub 계정 기준입니다. 커밋 이메일이 GitHub 계정과 연결되어 있으면 이름이 달라도 같은 계정으로 묶고, 연결되지 않은 커밋은 작성자
                  이메일별로 따로 표시합니다(이메일은 화면에 보이지 않음). GitHub 웹에서 만든 병합 커밋은 작성한 사람의 계정으로 셉니다.
                </li>
                <li>
                  커밋 수는 작업을 나누어 기록하는 방식에 따라 크게 달라지므로, 작업량이나 기여도를 비교하는 지표로 쓰지 마세요. 공동 작성 표시(Co-Authored-By,
                  예: AI 도구)는 커밋 작성자 수에 넣지 않고 각 커밋에만 표시합니다.
                </li>
              </ul>
            </More>
          </>
        }
      >
        <Segmented
          label="집계 단위"
          items={(["day", "week", "month"] as const).map((u) => ({ href: hrefOf(options, { unit: u }), text: UNIT_TEXT[u], active: u === report.unit }))}
        />
        <StackedBarChart
          title={`${UNIT_TEXT[report.unit]} 커밋 수`}
          unit="건"
          labels={report.buckets.map((b) => bucketLabel(b, report.unit))}
          series={report.series.map((s) => ({ label: s.label, values: s.values, tone: tones.get(s.key) ?? 4 }))}
          inProgress
        />
      </Section>

      <Section title="개발 활동 히트맵" description="하루 단위 커밋 수입니다. 색이 진할수록 커밋이 많은 날이며, 고른 기간(최소 12주, 최대 1년)을 보여 줍니다.">
        <CommitHeatmap report={report} />
      </Section>

      <Section title="개발자별 활동" description="고른 기간의 개발자별 커밋 기록입니다. 최근에 활동한 순서로 보여 주며, 순위나 기여도 평가가 아닙니다.">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[40rem] text-right text-xs tabular-nums">
            <caption className="sr-only">개발자별 커밋 기록</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-1.5 pr-2 text-left font-medium">개발자</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">커밋</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">커밋한 날</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">첫 커밋</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">최근 커밋</th>
                <th scope="col" className="w-32 py-1.5 pr-2 font-medium">추이({UNIT_TEXT[report.unit]})</th>
              </tr>
            </thead>
            <tbody>
              {report.authors.map((a) => (
                <tr key={a.key} className={`border-t border-border text-foreground ${report.author && report.author !== a.key ? "opacity-50" : ""}`}>
                  <th scope="row" className="py-2 pr-2 text-left font-normal">
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: `var(--chart-${tones.get(a.key) ?? 4})` }} />
                      <span className="flex min-w-0 flex-col">
                        <AuthorName login={a.login} name={a.name} profileUrl={a.profileUrl} />
                        <span className="text-[11px] text-muted-foreground">
                          {a.login ? `커밋 이름: ${a.names.join(", ")}` : "GitHub 계정 미연결"} · 전체 {fmt(a.allTime)}건
                        </span>
                      </span>
                    </span>
                  </th>
                  <td className="py-2 pr-2">{fmt(a.commits)}</td>
                  <td className="py-2 pr-2">{fmt(a.activeDays)}</td>
                  <td className="py-2 pr-2">{a.first ? kstStamp(a.first) : "-"}</td>
                  <td className="py-2 pr-2">{a.last ? kstStamp(a.last) : "-"}</td>
                  <td className="py-2 pr-2">{a.commits > 0 && report.buckets.length > 1 ? <Sparkline values={a.series} /> : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="최근 개발 업데이트"
        description={
          <>
            <p>
              {periodText}의 커밋을 날짜별로 보여 줍니다(최신순). 제목이나 SHA를 누르면 GitHub 커밋 페이지가 새 탭에서 열립니다.
            </p>
            <p className="mt-1">
              Production 배포 여부는 표시하지 않습니다. 배포 기록을 읽으려면 계정 전체 권한의 Vercel 토큰이 필요하고, 오래된 배포는 보존 기간이 지나 삭제되어
              어떤 커밋이 언제 배포됐는지 정확히 확인할 수 없기 때문입니다.
            </p>
          </>
        }
      >
        <div id="dev-timeline" className="scroll-mt-20" />
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">이 기간에 커밋이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((g) => (
              <div key={g.day} className="flex flex-col gap-2">
                <SubHeading basis={`${fmt(g.commits.length)}건`}>{dayTitle(g.day)}</SubHeading>
                <ol className="flex flex-col">
                  {g.commits.map((c) => (
                    <CommitItem key={c.sha} c={c} tone={tones.get(c.author.key)} />
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
        {report.commits.length > visible.length && (
          <Link
            href={hrefOf(options, { limit: options.limit + TIMELINE_STEP }, "#dev-timeline")}
            scroll={false}
            className="self-start rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            더 보기 ({fmt(visible.length)}/{fmt(report.commits.length)}건)
          </Link>
        )}
      </Section>
    </div>
  );
}
