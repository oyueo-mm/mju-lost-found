import { loadCommitFeed, loadCompare, type CommitFeed, type CompareResult, type DevCommit } from "./github";
import { loadDeploymentRecords } from "./deployments";
import { loadLiveVersion, type LiveVersion } from "./live";
import {
  changeBetween,
  compareKey,
  comparePairs,
  currentPreview,
  currentProduction,
  graphOf,
  isRelease,
  mergeDeployments,
  releasesOf,
  timeOf,
  type Change,
  type CurrentVersion,
  type Deployment,
  type Release,
} from "./releases";
import { bucketOf, buildDevReport, inSelection, kstDayOf, nextBucket, type DevReport, type DevSelection, type DevUnit, type ResolvedSelection } from "./stats";
import type { Coverage } from "@/lib/metrics/report";
import { loadVercelFeed, type VercelFeed } from "./vercel";

// 개발 통계: everything the tab shows, each source on its own -- a failed
// GitHub, Vercel or database read only empties its own part.

export type DeployEnv = "all" | "production" | "preview" | "commits" | "deploys";
export const isDeployEnv = (v: unknown): v is DeployEnv => v === "all" || v === "production" || v === "preview" || v === "commits" || v === "deploys";

export type DeployStats = {
  buckets: string[];
  // per bucket: before the first recorded deployment nothing is known
  // ("none", never 0), the bucket holding it is "partial"
  coverage: Coverage[];
  // the selection starts before the first record: its totals cover less
  beforeRecords: boolean;
  production: number[]; // finished Production builds (releases) per bucket
  preview: number[]; // finished Preview builds per bucket
  failed: number[]; // failed or canceled builds, either environment
  totals: { production: number; preview: number; failed: number; finished: number; unknownState: number };
  successRate: number | null; // ready / (ready + failed + canceled), over the period
};

export function deployStats(
  list: Deployment[],
  sel: Pick<ResolvedSelection, "from" | "to" | "days">,
  unit: DevUnit,
  buckets: string[],
  firstRecordDay: string | null,
): DeployStats {
  const index = new Map(buckets.map((b, i) => [b, i]));
  const zeros = () => buckets.map(() => 0);
  const out = { production: zeros(), preview: zeros(), failed: zeros() };
  const totals = { production: 0, preview: 0, failed: 0, finished: 0, unknownState: 0 };
  for (const d of list) {
    const t = timeOf(d);
    if (!t) continue;
    const day = kstDayOf(t);
    if (!inSelection(sel, day)) continue;
    const i = index.get(bucketOf(day, unit));
    if (d.state === "READY") {
      totals[d.target]++;
      totals.finished++;
      if (i !== undefined) out[d.target][i]++;
    } else if (d.state === "ERROR" || d.state === "CANCELED") {
      totals.failed++;
      totals.finished++;
      if (i !== undefined) out.failed[i]++;
    } else totals.unknownState++;
  }
  // a bucket [b, its end) wholly before the first record is unknown, one
  // holding it is partly known
  const coverage = buckets.map((b): Coverage => {
    if (!firstRecordDay) return "none";
    if (nextBucket(b, unit) <= firstRecordDay) return "none";
    return b < firstRecordDay ? "partial" : "full";
  });
  return {
    buckets,
    coverage,
    beforeRecords: !firstRecordDay || sel.from < firstRecordDay,
    ...out,
    totals,
    successRate: totals.finished ? (totals.production + totals.preview) / totals.finished : null,
  };
}

export type DevDashboard = {
  feed: CommitFeed;
  report: DevReport | null;
  records: "ok" | "failed";
  vercel: VercelFeed;
  live: LiveVersion;
  deployments: Deployment[];
  firstRecord: string | null; // the oldest recorded deployment time: nothing before it is known
  production: CurrentVersion;
  preview: CurrentVersion;
  pending: Change | null; // what the Preview URL has and Production does not
  releases: Release[];
  commits: Map<string, DevCommit>; // the branch's commits, plus those found by Compare
  stats: DeployStats | null;
};

export async function loadDevDashboard(
  { selection, unit, author, today }: { selection: DevSelection; unit: DevUnit | null; author: string | null; today: string },
  self: { id: string; viaAlias: boolean } | null,
): Promise<DevDashboard> {
  const [feed, records, vercel, live] = await Promise.all([loadCommitFeed(), loadDeploymentRecords(), loadVercelFeed(), loadLiveVersion()]);
  const report = feed.ok ? buildDevReport(feed.commits, { selection, unit, author, today }) : null;
  const deployments = mergeDeployments(records, vercel.ok ? vercel.deployments : null);
  const graph = graphOf(feed.ok ? feed.commits : []);
  const production = currentProduction(deployments, live, vercel.ok ? vercel.productionId : null);
  const preview = currentPreview(deployments, vercel.ok ? vercel.previewAliasId : null, self);
  const releases0 = deployments.filter(isRelease).sort((a, b) => timeOf(a).localeCompare(timeOf(b)));

  // GitHub Compare only for pairs off the branch list, few per view
  const compares = new Map<string, CompareResult>();
  if (feed.ok) {
    const pairs = comparePairs(graph, releases0, [production.gitSha, preview.gitSha]);
    const results = await Promise.all(pairs.map(([b, h]) => loadCompare(b, h)));
    pairs.forEach(([b, h], i) => compares.set(compareKey(b, h), results[i]));
  }
  const commits = new Map<string, DevCommit>((feed.ok ? feed.commits : []).map((c) => [c.sha, c]));
  for (const r of compares.values()) if (r.ok) for (const c of r.commits) if (!commits.has(c.sha)) commits.set(c.sha, c);

  const pending = production.gitSha && preview.gitSha && feed.ok ? changeBetween(graph, production.gitSha, preview.gitSha, compares) : null;
  const times = deployments.map(timeOf).filter(Boolean).sort();
  return {
    feed,
    report,
    records: records === null ? "failed" : "ok",
    vercel,
    live,
    deployments,
    firstRecord: times[0] ?? null,
    production,
    preview,
    pending,
    releases: releasesOf(deployments, graph, compares),
    commits,
    stats: report ? deployStats(deployments, report, report.unit, report.buckets, times[0] ? kstDayOf(times[0]) : null) : null,
  };
}
