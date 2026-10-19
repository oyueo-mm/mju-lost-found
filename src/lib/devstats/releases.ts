import type { CompareResult, DevCommit } from "./github";
import type { DeploymentRecordRow } from "./deployments";
import type { LiveVersion } from "./live";
import type { VercelDeploymentRow } from "./vercelDeployment.mjs";

// GitHub commits and Vercel deployments, linked (pure). Which commits a
// deployment contains comes from Git itself: the parents of the branch's
// commits (exact for every deployed commit on the branch), or GitHub's
// Compare API for one that is not. A deployment without a commit, a commit
// GitHub does not know, or a pair nobody compared is "확인 불가" -- never
// filled in from times or order. A Preview deployment is never a release:
// only Production deployments that finished building count as one.

export type Deployment = DeploymentRecordRow & {
  inVercel: boolean | null; // still listed by Vercel (null: no API to ask)
};

export type Unknown = { status: "unknown"; reason: string };
export type Change =
  | { status: "ok"; kind: "new" | "same" | "rollback" | "diverged"; commits: string[]; removed: number; via: "graph" | "compare" }
  | Unknown;

export type CurrentVersion = {
  id: string | null;
  deployment: Deployment | null;
  gitSha: string | null;
  // how it is known: Production's own answer, the Vercel API, the
  // deployment serving this page, or the last time the recorder saw it
  basis: "live" | "api" | "self" | "record" | "unknown";
  checkedAt: string | null;
};

export function mergeDeployments(records: DeploymentRecordRow[] | null, api: VercelDeploymentRow[] | null): Deployment[] {
  const byId = new Map<string, Deployment>();
  for (const r of records ?? []) byId.set(r.id, { ...r, inVercel: null });
  for (const a of api ?? []) {
    const r = byId.get(a.id);
    byId.set(a.id, {
      firstSeenAt: r?.firstSeenAt ?? null,
      currentAt: r?.currentAt ?? null,
      id: a.id,
      target: a.target,
      url: a.url ?? r?.url ?? null,
      gitSha: a.gitSha ?? r?.gitSha ?? null,
      gitMessage: a.gitMessage ?? r?.gitMessage ?? null,
      gitDirty: a.gitDirty ?? r?.gitDirty ?? null,
      state: a.state ?? r?.state ?? null,
      createdAt: a.createdAt ?? r?.createdAt ?? null,
      readyAt: a.readyAt ?? r?.readyAt ?? null,
      sources: [...new Set([...(r?.sources ?? []), "api" as const])],
      inVercel: true,
    });
  }
  if (api) for (const d of byId.values()) if (d.inVercel === null) d.inVercel = false;
  return [...byId.values()].sort((a, b) => timeOf(b).localeCompare(timeOf(a)));
}

// When a deployment happened, for ordering: Vercel's creation time, else
// when it first ran.
export const timeOf = (d: Pick<Deployment, "createdAt" | "firstSeenAt">) => d.createdAt ?? d.firstSeenAt ?? "";

// A release: a Production deployment whose build finished.
export const isRelease = (d: Deployment) => d.target === "production" && d.state === "READY";

export type Graph = Map<string, string[]>;
export const graphOf = (commits: DevCommit[]): Graph => new Map(commits.map((c) => [c.sha, c.parents]));

// Every commit reachable from `sha` (itself included), or null when `sha`
// is not on the branch list.
export function ancestorsOf(graph: Graph, sha: string, memo = new Map<string, Set<string>>()): Set<string> | null {
  if (!graph.has(sha)) return null;
  const hit = memo.get(sha);
  if (hit) return hit;
  const seen = new Set<string>();
  const stack = [sha];
  while (stack.length) {
    const s = stack.pop()!;
    if (seen.has(s)) continue;
    seen.add(s);
    for (const p of graph.get(s) ?? []) if (graph.has(p)) stack.push(p);
  }
  memo.set(sha, seen);
  return seen;
}

export const compareKey = (base: string, head: string) => `${base}...${head}`;

const NOT_FOUND = "GitHub에 없는 커밋이라 확인할 수 없습니다(아직 push하지 않았거나 지워진 커밋).";
export function unknownOf(reason: Extract<CompareResult, { ok: false }>["reason"] | "no_sha" | "no_base" | "not_compared"): Unknown {
  const text = {
    no_sha: "배포에 Git 커밋 정보가 없어 확인할 수 없습니다.",
    no_base: "기록된 직전 Production 배포가 없어 비교할 수 없습니다(배포 이력 기록 전).",
    not_compared: "GitHub 비교 요청 한도를 아끼려고 이번 화면에서는 비교하지 않았습니다.",
    not_found: NOT_FOUND,
    rate_limited: "GitHub API 요청 한도에 도달해 확인할 수 없습니다.",
    unavailable: "GitHub에 연결하지 못해 확인할 수 없습니다.",
  }[reason];
  return { status: "unknown", reason: text };
}

// The commits `head` has and `base` does not, newest first.
export function changeBetween(graph: Graph, base: string | null, head: string | null, compares: Map<string, CompareResult>, memo = new Map<string, Set<string>>()): Change {
  if (!head) return unknownOf("no_sha");
  if (!base) return unknownOf("no_base");
  if (base === head) return { status: "ok", kind: "same", commits: [], removed: 0, via: "graph" };
  const a = ancestorsOf(graph, head, memo);
  const b = ancestorsOf(graph, base, memo);
  if (a && b) {
    const added = [...a].filter((s) => !b.has(s));
    const removed = [...b].filter((s) => !a.has(s)).length;
    const kind = added.length === 0 ? (removed > 0 ? "rollback" : "same") : removed > 0 ? "diverged" : "new";
    return { status: "ok", kind, commits: added, removed, via: "graph" };
  }
  const c = compares.get(compareKey(base, head));
  if (!c) return unknownOf("not_compared");
  if (!c.ok) return unknownOf(c.reason);
  const kind = c.status === "identical" ? "same" : c.status === "behind" ? "rollback" : c.status === "diverged" ? "diverged" : "new";
  return { status: "ok", kind, commits: c.commits.map((x) => x.sha).reverse(), removed: c.behindBy, via: "compare" };
}

// The pairs a page needs GitHub's Compare for (a side not on the branch
// list), in order of importance, at most `limit`.
export function comparePairs(graph: Graph, releases: Deployment[], pending: [string | null, string | null] | null, limit = 6): [string, string][] {
  const out: [string, string][] = [];
  const add = (base: string | null, head: string | null) => {
    if (!base || !head || base === head || (graph.has(base) && graph.has(head))) return;
    if (!out.some(([x, y]) => x === base && y === head)) out.push([base, head]);
  };
  if (pending) add(pending[0], pending[1]);
  for (let i = releases.length - 1; i > 0; i--) add(releases[i - 1].gitSha, releases[i].gitSha);
  return out.slice(0, limit);
}

export type Release = {
  deployment: Deployment;
  previous: Deployment | null; // the release recorded just before it
  change: Change;
  verifiedOn: Deployment[]; // Preview deployments of the same commit made before it
};

// Releases in order (oldest first), each against the one recorded before.
export function releasesOf(deployments: Deployment[], graph: Graph, compares: Map<string, CompareResult>): Release[] {
  const memo = new Map<string, Set<string>>();
  const releases = deployments.filter(isRelease).sort((a, b) => timeOf(a).localeCompare(timeOf(b)));
  return releases.map((d, i) => {
    const previous = releases[i - 1] ?? null;
    return {
      deployment: d,
      previous,
      change: previous ? changeBetween(graph, previous.gitSha, d.gitSha, compares, memo) : unknownOf("no_base"),
      verifiedOn: deployments.filter((p) => p.target === "preview" && p.gitSha && p.gitSha === d.gitSha && timeOf(p) <= timeOf(d)),
    };
  });
}

export function currentProduction(deployments: Deployment[], live: LiveVersion, apiProductionId: string | null): CurrentVersion {
  const find = (id: string | null) => deployments.find((d) => d.id === id) ?? null;
  if (live.ok) {
    const d = find(live.deploymentId);
    return { id: live.deploymentId, deployment: d, gitSha: live.gitSha ?? d?.gitSha ?? null, basis: "live", checkedAt: live.checkedAt };
  }
  if (apiProductionId) {
    const d = find(apiProductionId);
    return { id: apiProductionId, deployment: d, gitSha: d?.gitSha ?? null, basis: "api", checkedAt: null };
  }
  const seen = deployments.filter((d) => d.target === "production" && d.currentAt).sort((a, b) => b.currentAt!.localeCompare(a.currentAt!))[0];
  if (seen) return { id: seen.id, deployment: seen, gitSha: seen.gitSha, basis: "record", checkedAt: seen.currentAt };
  return { id: null, deployment: null, gitSha: null, basis: "unknown", checkedAt: null };
}

// The fixed Preview URL's deployment: the API's alias, the deployment
// rendering this page when it was opened through that URL, or the last
// time the recorder saw it.
export function currentPreview(deployments: Deployment[], apiAliasId: string | null, self: { id: string; viaAlias: boolean } | null): CurrentVersion {
  const find = (id: string | null) => deployments.find((d) => d.id === id) ?? null;
  if (apiAliasId) {
    const d = find(apiAliasId);
    return { id: apiAliasId, deployment: d, gitSha: d?.gitSha ?? null, basis: "api", checkedAt: null };
  }
  if (self?.viaAlias) {
    const d = find(self.id);
    return { id: self.id, deployment: d, gitSha: d?.gitSha ?? null, basis: "self", checkedAt: null };
  }
  const seen = deployments.filter((d) => d.target === "preview" && d.currentAt).sort((a, b) => b.currentAt!.localeCompare(a.currentAt!))[0];
  if (seen) return { id: seen.id, deployment: seen, gitSha: seen.gitSha, basis: "record", checkedAt: seen.currentAt };
  return { id: null, deployment: null, gitSha: null, basis: "unknown", checkedAt: null };
}

// Where a commit went: the first release and the first Preview deployment
// containing it (null: none recorded; `unknown`: some deployments could
// not be checked -- their commit is not on the branch list).
export function traceCommit(sha: string, deployments: Deployment[], graph: Graph, memo = new Map<string, Set<string>>()) {
  const ordered = deployments.filter((d) => d.state === "READY").sort((a, b) => timeOf(a).localeCompare(timeOf(b)));
  let unknown = 0;
  const containing = ordered.filter((d) => {
    if (!d.gitSha) return false;
    const a = ancestorsOf(graph, d.gitSha, memo);
    if (!a) {
      unknown++;
      return false;
    }
    return a.has(sha);
  });
  return {
    production: containing.find((d) => d.target === "production") ?? null,
    preview: containing.find((d) => d.target === "preview") ?? null,
    all: containing,
    unknown,
  };
}
