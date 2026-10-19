import Link from "next/link";

import { DAY_TONES, GroupedBarChart, Sparkline, StackedBarChart, type ChartTone } from "@/components/admin/StatsCharts";
import { More, Section, StatTile, SubHeading } from "@/components/admin/StatsBlocks";
import { AlertIcon, InfoIcon } from "@/components/icons";
import { addDays } from "@/lib/metrics/daySelection";
import { GITHUB_REPO, MAX_COMMITS, REPO_URL, REVALIDATE_SECONDS, type CommitFeed, type DevCommit } from "@/lib/devstats/github";
import { DEV_PERIODS, kstDayOf, kstTimeOf, type DevReport, type DevUnit } from "@/lib/devstats/stats";
import type { DeployEnv, DevDashboard } from "@/lib/devstats/dashboard";
import { graphOf, timeOf, traceCommit, type Change, type CurrentVersion, type Deployment, type Release } from "@/lib/devstats/releases";
import { inspectorUrl } from "@/lib/devstats/vercelDeployment.mjs";

// 개발자 통계 (/admin/stats?tab=dev): the repository's commits from GitHub
// and the Vercel deployments that carried them (lib/devstats). Read-only;
// links go to GitHub and the Vercel dashboard. Filters live in the URL: dp
// (period), da (developer), de (deployment environment), du (unit), dn
// (timeline length). Commit time (authored), deployment creation and build
// finish are always labelled apart; a Preview deployment is never a release.

const fmt = (n: number) => n.toLocaleString("ko-KR");
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const dayTitle = (day: string) => `${day.slice(0, 4)}년 ${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일 (${DOW[new Date(`${day}T00:00:00Z`).getUTCDay()]})`;
const kstStamp = (iso: string) => `${kstDayOf(iso)} ${kstTimeOf(iso)}`;
const bucketLabel = (b: string, unit: DevUnit) => (unit === "month" ? `${b.slice(2, 4)}.${Number(b.slice(5, 7))}` : unit === "week" ? `${md(b)}~` : md(b));
const UNIT_TEXT: Record<DevUnit, string> = { day: "일별", week: "주별", month: "월별" };
export const TIMELINE_STEP = 40;
const external = { target: "_blank", rel: "noopener noreferrer" } as const;

export type DevOptions = { period: DevReport["period"]; unit: DevUnit | null; author: string | null; env: DeployEnv; limit: number };

function hrefOf(o: DevOptions, patch: Partial<DevOptions>, hash = "") {
  const s = { ...o, ...patch };
  const q = new URLSearchParams({ tab: "dev", dp: s.period });
  if (s.unit) q.set("du", s.unit);
  if (s.author) q.set("da", s.author);
  if (s.env !== "all") q.set("de", s.env);
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

function CommitItem({ c, tone, trace }: { c: DevCommit; tone: ChartTone | undefined; trace?: ReturnType<typeof traceCommit> }) {
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
        </p>
        {trace && (
          <p className="flex flex-wrap gap-1.5 text-[10px]">
            {trace.production ? (
              <span className="rounded-md bg-primary-muted px-1.5 py-0.5 font-medium text-primary">
                Production 반영 {trace.production.createdAt ? kstStamp(trace.production.createdAt) : ""} ({trace.production.id.replace(/^dpl_/, "").slice(0, 9)})
              </span>
            ) : (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
                {trace.unknown ? "Production 반영 확인 불가" : "기록된 Production 출시에 없음"}
              </span>
            )}
            {trace.preview && <span className="rounded-md border border-border px-1.5 py-0.5 text-muted-foreground">Preview 배포 {trace.preview.createdAt ? kstStamp(trace.preview.createdAt) : ""}</span>}
          </p>
        )}
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

// ---------- deployments ----------

const TARGET_TEXT = { production: "Production", preview: "Preview" } as const;
const STATE_TEXT: Record<string, string> = {
  READY: "성공",
  ERROR: "실패",
  CANCELED: "취소",
  BUILDING: "빌드 중",
  QUEUED: "대기",
  INITIALIZING: "준비 중",
  DELETED: "삭제됨",
};

function TargetBadge({ target }: { target: Deployment["target"] }) {
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
        target === "production" ? "bg-primary text-primary-foreground" : "border border-border bg-muted text-muted-foreground"
      }`}
    >
      {TARGET_TEXT[target]}
    </span>
  );
}

function StateBadge({ state }: { state: string | null }) {
  const tone = state === "READY" ? "bg-success-muted text-success" : state === "ERROR" || state === "CANCELED" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground";
  return <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{state ? (STATE_TEXT[state] ?? state) : "상태 확인 불가"}</span>;
}

const shortId = (id: string) => id.replace(/^dpl_/, "").slice(0, 9);

function ShaLink({ sha, known }: { sha: string | null; known: boolean }) {
  if (!sha) return <span className="text-muted-foreground">커밋 확인 불가</span>;
  return known ? (
    <a href={`${REPO_URL}/commit/${sha}`} {...external} className="font-mono hover:text-primary hover:underline">
      {sha.slice(0, 7)}
    </a>
  ) : (
    <span className="font-mono" title="GitHub에 없는 커밋(push 전이거나 다른 저장소)">
      {sha.slice(0, 7)} <span className="font-sans text-muted-foreground">(GitHub에 없음)</span>
    </span>
  );
}

// When: Vercel's creation time and build finish, or (only from the
// deployment itself) when it first ran -- never one standing in for another.
function DeployTimes({ d }: { d: Deployment }) {
  return (
    <span className="flex flex-wrap gap-x-2">
      <span>생성 {d.createdAt ? kstStamp(d.createdAt) : "확인 불가"}</span>
      <span>빌드 완료 {d.readyAt ? kstStamp(d.readyAt) : d.state === "ERROR" || d.state === "CANCELED" ? "-" : "확인 불가"}</span>
      {d.firstSeenAt && <span>첫 실행 {kstStamp(d.firstSeenAt)}</span>}
    </span>
  );
}

function DeploymentLinks({ d }: { d: Deployment }) {
  return (
    <span className="flex flex-wrap gap-x-2">
      <a href={inspectorUrl(d.id)} {...external} className="text-primary hover:underline">
        Vercel에서 보기
      </a>
      {d.url && d.inVercel !== false && (
        <a href={`https://${d.url}`} {...external} className="text-primary hover:underline">
          배포 URL
        </a>
      )}
      {d.inVercel === false && <span className="text-muted-foreground">Vercel에서 삭제됨(기록으로 보존)</span>}
    </span>
  );
}

const BASIS_TEXT: Record<CurrentVersion["basis"], string> = {
  live: "Production 도메인에서 지금 확인",
  api: "Vercel API로 확인",
  self: "이 화면을 보여 준 배포(고정 Preview URL)",
  record: "배포 기록 시점의 확인",
  unknown: "확인 불가",
};

function VersionCard({ title, v, commits, note }: { title: string; v: CurrentVersion; commits: Map<string, DevCommit>; note: string }) {
  const d = v.deployment;
  const commit = v.gitSha ? commits.get(v.gitSha) : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-card border border-border bg-muted/30 p-3 text-xs">
      <p className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-[11px] text-muted-foreground">{BASIS_TEXT[v.basis]}</span>
      </p>
      {v.basis === "unknown" ? (
        <p className="leading-relaxed text-muted-foreground">{note}</p>
      ) : (
        <>
          <p className="font-medium [overflow-wrap:anywhere] text-foreground">{commit?.title ?? d?.gitMessage ?? (v.gitSha ? "(커밋 메시지 확인 불가)" : "커밋 정보 없음")}</p>
          <p className="flex flex-wrap gap-x-2 text-muted-foreground">
            <ShaLink sha={v.gitSha} known={!!commit} />
            <span className="font-mono">{v.id ? shortId(v.id) : "-"}</span>
            {d?.gitDirty && <span className="text-warning">커밋하지 않은 변경 포함 배포</span>}
          </p>
          {d ? (
            <>
              <p className="text-muted-foreground">
                <DeployTimes d={d} />
              </p>
              <p className="text-[11px]">
                <DeploymentLinks d={d} />
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">이 배포의 기록이 아직 없습니다(생성·완료 시각 확인 불가).</p>
          )}
          {v.basis === "record" && v.checkedAt && (
            <p className="text-[11px] text-warning">{kstStamp(v.checkedAt)}에 확인한 값입니다. 그 뒤 바뀌었을 수 있습니다.</p>
          )}
        </>
      )}
    </div>
  );
}

function CommitList({ shas, commits, limit = 30 }: { shas: string[]; commits: Map<string, DevCommit>; limit?: number }) {
  const known = shas.map((s) => commits.get(s)).filter((c): c is DevCommit => !!c);
  known.sort((a, b) => b.authoredAt.localeCompare(a.authoredAt));
  return (
    <ul className="flex flex-col gap-1">
      {known.slice(0, limit).map((c) => (
        <li key={c.sha} className="flex gap-2 text-[11px]">
          <a href={c.url} {...external} className="shrink-0 font-mono text-muted-foreground hover:text-primary hover:underline">
            {c.sha.slice(0, 7)}
          </a>
          <span className="min-w-0 [overflow-wrap:anywhere] text-foreground">{c.title}</span>
          <span className="shrink-0 text-muted-foreground">{c.author.login ?? c.author.name}</span>
        </li>
      ))}
      {known.length > limit && <li className="text-[11px] text-muted-foreground">외 {fmt(known.length - limit)}개</li>}
    </ul>
  );
}

// "release": a release against the one before it. "pending": the Preview
// URL's version against Production's -- there a Preview behind Production
// is not a rollback, only nothing waiting to be released.
function ChangeText({ change, commits, githubOk, context = "release" }: { change: Change; commits: Map<string, DevCommit>; githubOk: boolean; context?: "release" | "pending" }) {
  if (change.status === "unknown") return <p className="text-[11px] text-muted-foreground">{githubOk ? change.reason : "GitHub에 연결하지 못해 확인할 수 없습니다."}</p>;
  const pending = context === "pending";
  if (change.kind === "same")
    return <p className="text-[11px] text-muted-foreground">{pending ? "Preview와 Production이 같은 커밋입니다(출시를 기다리는 변경 없음)." : "같은 커밋을 다시 배포했습니다(새 변경 없음)."}</p>;
  if (pending && change.kind === "rollback")
    return (
      <p className="text-[11px] text-muted-foreground">
        출시를 기다리는 변경이 없습니다. Preview가 Production보다 이전 커밋입니다(Production에만 있는 커밋 {fmt(change.removed)}개).
      </p>
    );
  const head = pending
    ? `Preview에만 있는 커밋 ${fmt(change.commits.length)}개${change.kind === "diverged" ? ` (Production에만 있는 커밋 ${fmt(change.removed)}개도 있음)` : ""}`
    : change.kind === "rollback"
      ? `이전 버전으로 되돌림: 커밋 ${fmt(change.removed)}개가 빠졌습니다.`
      : `새 커밋 ${fmt(change.commits.length)}개${change.kind === "diverged" ? ` (갈라진 기록 — 빠진 커밋 ${fmt(change.removed)}개)` : ""}`;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-medium text-foreground">
        {head}
        {change.via === "compare" && <span className="font-normal text-muted-foreground"> · GitHub Compare</span>}
      </p>
      {change.commits.length > 0 && <CommitList shas={change.commits} commits={commits} />}
    </div>
  );
}

function ReleaseItem({ r, commits, githubOk }: { r: Release; commits: Map<string, DevCommit>; githubOk: boolean }) {
  const d = r.deployment;
  const commit = d.gitSha ? commits.get(d.gitSha) : undefined;
  return (
    <li className="flex flex-col gap-1.5 rounded-card border border-border p-3 text-xs">
      <p className="flex flex-wrap items-center gap-2">
        <TargetBadge target="production" />
        <StateBadge state={d.state} />
        <span className="font-medium [overflow-wrap:anywhere] text-foreground">{commit?.title ?? d.gitMessage ?? "커밋 메시지 확인 불가"}</span>
      </p>
      <p className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
        <ShaLink sha={d.gitSha} known={!!commit} />
        <span className="font-mono">{shortId(d.id)}</span>
        <DeployTimes d={d} />
      </p>
      <p className="text-[11px]">
        <DeploymentLinks d={d} />
      </p>
      <p className="text-[11px] text-muted-foreground">
        {r.verifiedOn.length
          ? `Preview에서 먼저 배포: ${r.verifiedOn.map((p) => `${shortId(p.id)}(${p.createdAt ? kstStamp(p.createdAt) : "시각 확인 불가"})`).join(", ")}`
          : "같은 커밋의 이전 Preview 배포 기록 없음"}
      </p>
      <details className="text-[11px]">
        <summary className="w-fit cursor-pointer font-medium text-primary">
          {r.previous ? `직전 Production(${shortId(r.previous.id)}) 대비 변경 내역` : "변경 내역"}
        </summary>
        <div className="mt-1.5">
          <ChangeText change={r.change} commits={commits} githubOk={githubOk} />
        </div>
      </details>
    </li>
  );
}

// ---------- the tab ----------

const NO_TOKEN = "Vercel API 토큰이 없어 배포 목록은 배포 기록(DeploymentRecord)만 사용합니다.";
const VERCEL_REASON: Record<string, string> = {
  no_token: NO_TOKEN,
  unauthorized: "Vercel API 토큰이 거부되었습니다(만료·권한 확인 필요). 배포 기록만 사용합니다.",
  rate_limited: "Vercel API 요청 한도에 도달했습니다. 배포 기록만 사용합니다.",
  unavailable: "Vercel API에 연결하지 못했습니다. 배포 기록만 사용합니다.",
};

type Item = { kind: "commit"; at: string; commit: DevCommit } | { kind: "deploy"; at: string; d: Deployment };

export function DevStatsView({ dash, options }: { dash: DevDashboard; options: DevOptions }) {
  const { feed, report } = dash;
  const source = (
    <div className="flex flex-col gap-1 text-[11px] leading-relaxed text-muted-foreground">
      <p>
        GitHub:{" "}
        <a href={REPO_URL} {...external} className="font-medium text-primary hover:underline">
          {GITHUB_REPO.owner}/{GITHUB_REPO.repo}
        </a>{" "}
        · <span className="font-mono">{GITHUB_REPO.branch}</span> 브랜치{feed.ok ? ` · ${kstStamp(feed.fetchedAt)} 기준(최대 ${REVALIDATE_SECONDS / 60}분 간격 갱신)` : ""}
      </p>
      <p>
        Vercel:{" "}
        {dash.vercel.ok ? `API 연동 · ${kstStamp(dash.vercel.fetchedAt)} 기준` : "API 미연동"} · 배포 기록{" "}
        {dash.records === "failed"
          ? "읽기 실패"
          : dash.deployments.length
            ? `${fmt(dash.deployments.length)}건 (가장 오래된 기록 ${dash.firstRecord ? kstStamp(dash.firstRecord) : "-"}, 그 이전 배포는 확인 불가)`
            : "없음"}
      </p>
    </div>
  );
  const notices = (
    <>
      {!feed.ok && <FeedError feed={feed} />}
      {(!dash.vercel.ok || dash.records === "failed") && (
        <p className="flex gap-2 rounded-card border border-border bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            {!dash.vercel.ok && VERCEL_REASON[dash.vercel.reason]}
            {dash.records === "failed" && " 배포 기록을 읽지 못했습니다(배포 이력 테이블이 아직 없거나 DB 오류)."}
          </span>
        </p>
      )}
    </>
  );
  if (!report)
    return (
      <div className="flex flex-col gap-3">
        {source}
        {notices}
      </div>
    );

  const tones = toneMap(report);
  const period = DEV_PERIODS.find((p) => p.key === report.period)!;
  const periodText = `${report.from} ~ ${report.to}`;
  const filtered = report.author ? report.authors.find((a) => a.key === report.author) : null;
  const inPeriod = (iso: string) => {
    const day = kstDayOf(iso);
    return day >= report.from && day <= report.to;
  };
  const env = options.env;
  const deploysShown = dash.deployments.filter((d) => {
    const t = timeOf(d);
    if (!t || !inPeriod(t)) return false;
    return env === "all" || env === "deploys" || env === d.target;
  });
  const items: Item[] = [
    ...(env === "deploys" ? [] : report.commits.map((c): Item => ({ kind: "commit", at: c.authoredAt, commit: c }))),
    ...(env === "commits" ? [] : deploysShown.map((d): Item => ({ kind: "deploy", at: timeOf(d), d }))),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const visible = items.slice(0, options.limit);
  const groups: { day: string; items: Item[] }[] = [];
  for (const it of visible) {
    const day = kstDayOf(it.at);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(it);
    else groups.push({ day, items: [it] });
  }
  const graph = graphOf(feed.ok ? feed.commits : []);
  const memo = new Map<string, Set<string>>();
  const s = dash.stats;
  const last = report.totals.lastCommit;
  const releasesInPeriod = dash.releases.filter((r) => inPeriod(timeOf(r.deployment))).reverse();
  const pending = dash.pending;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {source}
        {notices}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <Segmented label="기간" items={DEV_PERIODS.map((p) => ({ href: hrefOf(options, { period: p.key, unit: null, limit: TIMELINE_STEP }), text: p.label, active: p.key === report.period }))} />
          <Segmented
            label="개발자"
            items={[
              { href: hrefOf(options, { author: null, limit: TIMELINE_STEP }), text: "전체 개발자", active: !report.author },
              ...report.authors.map((a) => ({ href: hrefOf(options, { author: a.key, limit: TIMELINE_STEP }), text: a.login ?? a.name, active: a.key === report.author })),
            ]}
          />
          <Segmented
            label="배포 환경"
            items={(
              [
                ["all", "커밋+전체 배포"],
                ["production", "Production"],
                ["preview", "Preview"],
                ["deploys", "배포만"],
                ["commits", "커밋만"],
              ] as const
            ).map(([k, text]) => ({ href: hrefOf(options, { env: k, limit: TIMELINE_STEP }), text, active: env === k }))}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {period.label} ({periodText}){filtered ? ` · ${filtered.login ?? filtered.name}` : ""} · 한국 시간 기준 · 커밋은 작성 시각, 배포는 Vercel 생성 시각
          {feed.ok && feed.truncated ? ` · 최근 커밋 ${fmt(MAX_COMMITS)}개까지만 반영` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile primary label="커밋" value={`${fmt(report.totals.commits)}건`} sub={report.totals.merges ? `병합 ${fmt(report.totals.merges)}건 포함` : `${period.label}`} />
        <StatTile primary label="커밋한 날" value={`${fmt(report.totals.activeDays)}일`} sub={`참여 개발자 ${fmt(report.totals.authors)}명`} />
        <StatTile
          primary
          label="최근 커밋"
          value={last ? kstDayOf(last.authoredAt).slice(5).replace("-", "/") : "-"}
          sub={last ? `${kstTimeOf(last.authoredAt)} · ${last.author.login ?? last.author.name}` : "이 기간에 커밋 없음"}
        />
        <StatTile primary label="Production 배포" value={s ? `${fmt(s.totals.production)}회` : "-"} sub="빌드가 끝난 출시 · 기록 기준" />
        <StatTile primary label="Preview 배포" value={s ? `${fmt(s.totals.preview)}회` : "-"} sub="출시 아님 · 기록 기준" />
        <StatTile
          primary
          label="배포 성공률"
          value={s?.successRate === null || !s ? "-" : `${Math.round(s.successRate * 1000) / 10}%`}
          sub={s ? `실패·취소 ${fmt(s.totals.failed)}회${s.totals.unknownState ? ` · 상태 확인 불가 ${fmt(s.totals.unknownState)}회` : ""}` : ""}
        />
      </div>

      <Section
        title="현재 버전"
        description="실제 서비스(mju-find.vercel.app)에 반영된 Production 버전과 고정 Preview URL의 버전입니다. Preview는 출시가 아닙니다."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <VersionCard
            title="Production (실제 서비스)"
            v={dash.production}
            commits={dash.commits}
            note={
              dash.live.ok
                ? "확인 불가"
                : dash.live.reason === "not_available"
                  ? "Production에 아직 버전 확인 기능(/api/version)이 없어 지금 반영된 버전을 확인할 수 없습니다. 이 기능이 출시되면 자동으로 표시됩니다."
                  : "Production 버전을 확인하지 못했습니다(연결 실패)."
            }
          />
          <VersionCard title="Preview (고정 URL)" v={dash.preview} commits={dash.commits} note="고정 Preview URL이 가리키는 배포를 확인할 수 없습니다(API 미연동이고 기록 없음)." />
        </div>
        <div className="flex flex-col gap-2">
          <SubHeading>Preview에는 있지만 Production에는 아직 없는 변경</SubHeading>
          {!pending ? (
            <p className="text-[11px] text-muted-foreground">두 버전 중 하나의 커밋을 확인할 수 없어 비교하지 않았습니다.</p>
          ) : (
            <ChangeText change={pending} commits={dash.commits} githubOk={feed.ok} context="pending" />
          )}
        </div>
      </Section>

      <Section
        title="커밋·배포 추이"
        description={
          <>
            <p>기간 안의 커밋 수(개발자별)와 배포 횟수를 {UNIT_TEXT[report.unit]}로 보여 줍니다.</p>
            <More label="집계 기준">
              <ul className="flex list-disc flex-col gap-1 pl-4">
                <li>
                  <span className="font-mono">{GITHUB_REPO.branch}</span> 브랜치에 들어간 커밋만 셉니다(다른 브랜치·PR에만 있는 커밋, 아직 push하지 않은 커밋 제외). 날짜는 커밋
                  작성 시각(author date)의 한국 날짜입니다.
                </li>
                <li>
                  개발자는 GitHub 계정 기준입니다. 커밋 이메일이 계정과 연결되어 있으면 이름이 달라도 같은 계정으로 묶고, 연결되지 않은 커밋은 작성자 이메일별로
                  따로 표시합니다(이메일은 화면에 보이지 않음).
                </li>
                <li>
                  커밋 수는 작업을 나누어 기록하는 방식에 따라 크게 달라지므로 작업량이나 기여도를 비교하는 지표로 쓰지 마세요.
                </li>
                <li>
                  배포는 배포 기록(가장 오래된 기록 {dash.firstRecord ? kstStamp(dash.firstRecord) : "없음"}) 기준이며, 그 이전에 Vercel에서 삭제된 배포는 확인할 수
                  없습니다. 날짜는 Vercel 생성 시각(없으면 첫 실행 시각)이고, 성공률은 끝난 빌드 중 성공한 비율입니다.
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
        <div className="grid gap-5 md:grid-cols-2">
          <StackedBarChart
            title={`${UNIT_TEXT[report.unit]} 커밋 수`}
            unit="건"
            labels={report.buckets.map((b) => bucketLabel(b, report.unit))}
            series={report.series.map((x) => ({ label: x.label, values: x.values, tone: tones.get(x.key) ?? 4 }))}
            inProgress
          />
          {s && (
            <GroupedBarChart
              title={`${UNIT_TEXT[report.unit]} 배포 횟수`}
              unit="회"
              labels={s.buckets.map((b) => bucketLabel(b, report.unit))}
              series={[
                { label: "Production 출시", values: s.production, tone: 1 },
                { label: "Preview", values: s.preview, tone: 4 },
                { label: "실패·취소", values: s.failed, tone: 2 },
              ]}
              inProgress
              note={dash.deployments.length ? undefined : "배포 기록이 아직 없습니다."}
            />
          )}
        </div>
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
        title="배포별 변경 내역"
        description="기간 안의 Production 출시(빌드가 끝난 Production 배포)마다, 기록된 직전 출시와 비교한 커밋입니다. 포함 여부는 Git 커밋 관계로만 판단하며, 기록 전 출시와 GitHub에 없는 커밋은 확인 불가로 둡니다."
      >
        {releasesInPeriod.length === 0 ? (
          <p className="text-xs text-muted-foreground">{dash.records === "failed" ? "배포 기록을 읽지 못했습니다." : "이 기간에 기록된 Production 출시가 없습니다."}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {releasesInPeriod.map((r) => (
              <ReleaseItem key={r.deployment.id} r={r} commits={dash.commits} githubOk={feed.ok} />
            ))}
          </ol>
        )}
      </Section>

      <Section
        title="개발·배포 타임라인"
        description={
          <p>
            {periodText}의 커밋(작성 시각)과 배포(Vercel 생성 시각)를 함께 보여 줍니다. 커밋마다 처음 포함된 Production 출시와 Preview 배포를 Git 관계로 찾아
            표시합니다. 제목·SHA를 누르면 GitHub, 배포의 링크는 Vercel이 새 탭에서 열립니다.
          </p>
        }
      >
        <div id="dev-timeline" className="scroll-mt-20" />
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">이 기간에 표시할 기록이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((g) => (
              <div key={g.day} className="flex flex-col gap-2">
                <SubHeading basis={`${fmt(g.items.length)}건`}>{dayTitle(g.day)}</SubHeading>
                <ol className="flex flex-col">
                  {g.items.map((it) =>
                    it.kind === "commit" ? (
                      <CommitItem key={`c-${it.commit.sha}`} c={it.commit} tone={tones.get(it.commit.author.key)} trace={traceCommit(it.commit.sha, dash.deployments, graph, memo)} />
                    ) : (
                      <DeployItem key={`d-${it.d.id}`} d={it.d} commits={dash.commits} />
                    ),
                  )}
                </ol>
              </div>
            ))}
          </div>
        )}
        {items.length > visible.length && (
          <Link
            href={hrefOf(options, { limit: options.limit + TIMELINE_STEP }, "#dev-timeline")}
            scroll={false}
            className="self-start rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            더 보기 ({fmt(visible.length)}/{fmt(items.length)}건)
          </Link>
        )}
      </Section>

      <More label="배포 이력은 어떻게 기록되나요?">
        <ul className="flex list-disc flex-col gap-1 pl-4">
          <li>배포가 처음 실행될 때 스스로 배포 ID·환경·커밋을 기록합니다(폴링·토큰 없음). 실행된 적 없는 배포(실패한 빌드 등)는 이 방식으로는 남지 않습니다.</li>
          <li>배포 스크립트(scripts/deployments)가 Vercel CLI 로그인으로 생성·완료 시각과 성공·실패 상태를 함께 기록합니다.</li>
          <li>Vercel API 토큰을 설정하면 매일 새벽 정리 작업과 이 화면에서 배포 목록을 받아 보존합니다(현재 {dash.vercel.ok ? "연동됨" : "미연동"}).</li>
          <li>기록을 시작하기 전에 Vercel에서 삭제된 배포는 복원하거나 추정하지 않습니다. 같은 배포는 ID로 한 번만 기록됩니다.</li>
        </ul>
      </More>
    </div>
  );
}

function DeployItem({ d, commits }: { d: Deployment; commits: Map<string, DevCommit> }) {
  const commit = d.gitSha ? commits.get(d.gitSha) : undefined;
  const dot = d.state === "ERROR" || d.state === "CANCELED" ? "var(--destructive)" : d.target === "production" ? "var(--primary)" : "var(--chart-4)";
  return (
    <li className="relative flex gap-3 pb-4 pl-5 last:pb-0">
      <span aria-hidden className="absolute top-1 left-[-1px] size-3 rotate-45 rounded-[2px]" style={{ backgroundColor: dot }} />
      <span aria-hidden className="absolute top-4 bottom-0 left-[4.5px] w-px bg-border" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] text-muted-foreground">
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <TargetBadge target={d.target} />
          <StateBadge state={d.state} />
          <span className="font-medium text-foreground">{d.target === "production" ? (d.state === "READY" ? "Production 출시" : "Production 배포") : "Preview 배포"}</span>
          <span className="font-mono">{shortId(d.id)}</span>
        </p>
        <p className="[overflow-wrap:anywhere]">
          <ShaLink sha={d.gitSha} known={!!commit} /> {commit?.title ?? d.gitMessage ?? ""}
          {d.gitDirty && <span className="text-warning"> · 커밋하지 않은 변경 포함</span>}
        </p>
        <DeployTimes d={d} />
        <DeploymentLinks d={d} />
      </div>
    </li>
  );
}
