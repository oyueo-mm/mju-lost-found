import { describe, expect, it } from "vitest";

import type { CompareResult, DevCommit } from "./github";
import {
  ancestorsOf,
  changeBetween,
  compareKey,
  comparePairs,
  currentPreview,
  currentProduction,
  graphOf,
  mergeDeployments,
  releasesOf,
  traceCommit,
  type Deployment,
} from "./releases";
import type { DeploymentRecordRow } from "./deployments";

// a, b, c, d on the branch in that order; x is a side branch off b
const sha = (ch: string) => ch.repeat(40);
const commit = (ch: string, parents: string[]): DevCommit => ({
  sha: sha(ch),
  title: `commit ${ch}`,
  body: "",
  authoredAt: "2026-10-10T00:00:00Z",
  committedAt: "2026-10-10T00:00:00Z",
  url: "",
  author: { key: "gh:a", login: "a", name: "a", profileUrl: null },
  merge: parents.length > 1,
  parents: parents.map(sha),
});
const commits = [commit("d", ["c"]), commit("c", ["b"]), commit("b", ["a"]), commit("a", [])];
const graph = graphOf(commits);

const dep = (id: string, target: "production" | "preview", ch: string | null, createdAt: string, over: Partial<Deployment> = {}): Deployment => ({
  id: `dpl_${id}`,
  target,
  url: `${id}.vercel.app`,
  gitSha: ch ? sha(ch) : null,
  gitMessage: null,
  gitDirty: null,
  state: "READY",
  createdAt,
  readyAt: createdAt,
  firstSeenAt: null,
  currentAt: null,
  sources: ["cli"],
  inVercel: null,
  ...over,
});

describe("커밋과 배포 연결", () => {
  it("finds what a commit contains through its parents", () => {
    expect([...ancestorsOf(graph, sha("c"))!].sort()).toEqual([sha("a"), sha("b"), sha("c")]);
    expect(ancestorsOf(graph, sha("z"))).toBeNull();
  });

  it("tells new commits, a redeploy, a rollback and unknowns apart", () => {
    const none = new Map<string, CompareResult>();
    expect(changeBetween(graph, sha("b"), sha("d"), none)).toMatchObject({ status: "ok", kind: "new", commits: expect.arrayContaining([sha("c"), sha("d")]), removed: 0, via: "graph" });
    expect(changeBetween(graph, sha("d"), sha("d"), none)).toMatchObject({ kind: "same", commits: [] });
    expect(changeBetween(graph, sha("d"), sha("b"), none)).toMatchObject({ kind: "rollback", removed: 2 });
    expect(changeBetween(graph, null, sha("d"), none)).toMatchObject({ status: "unknown", reason: expect.stringContaining("직전 Production") });
    expect(changeBetween(graph, sha("b"), null, none)).toMatchObject({ status: "unknown", reason: expect.stringContaining("Git 커밋 정보") });
    // off the branch list: only GitHub's Compare can tell
    expect(changeBetween(graph, sha("d"), sha("z"), none)).toMatchObject({ status: "unknown", reason: expect.stringContaining("비교하지 않았") });
    const compares = new Map<string, CompareResult>([
      [compareKey(sha("d"), sha("z")), { ok: false, reason: "not_found" }],
      [compareKey(sha("b"), sha("x")), { ok: true, status: "ahead", aheadBy: 1, behindBy: 0, commits: [commit("x", ["b"])], truncated: false }],
    ]);
    expect(changeBetween(graph, sha("d"), sha("z"), compares)).toMatchObject({ status: "unknown", reason: expect.stringContaining("GitHub에 없는 커밋") });
    expect(changeBetween(graph, sha("b"), sha("x"), compares)).toMatchObject({ status: "ok", kind: "new", commits: [sha("x")], via: "compare" });
  });

  it("asks Compare only for pairs off the branch list", () => {
    const releases = [dep("1", "production", "a", "2026-10-01T00:00:00Z"), dep("2", "production", "z", "2026-10-02T00:00:00Z"), dep("3", "production", "d", "2026-10-03T00:00:00Z")];
    expect(comparePairs(graph, releases, [sha("d"), sha("y")])).toEqual([
      [sha("d"), sha("y")],
      [sha("z"), sha("d")],
      [sha("a"), sha("z")],
    ]);
    expect(comparePairs(graph, releases.slice(0, 1), [sha("a"), sha("d")])).toEqual([]);
  });

  it("only finished Production deployments are releases; Preview of the same commit is noted, not counted", () => {
    const list = [
      dep("p1", "production", "b", "2026-10-01T00:00:00Z"),
      dep("v1", "preview", "d", "2026-10-02T00:00:00Z"),
      dep("p2", "production", "d", "2026-10-03T00:00:00Z"),
      dep("p3", "production", "d", "2026-10-04T00:00:00Z", { state: "ERROR", readyAt: null }),
      dep("v2", "preview", "d", "2026-10-05T00:00:00Z"),
    ];
    const releases = releasesOf(list, graph, new Map());
    expect(releases.map((r) => r.deployment.id)).toEqual(["dpl_p1", "dpl_p2"]);
    expect(releases[0].change).toMatchObject({ status: "unknown" });
    expect(releases[1].change).toMatchObject({ kind: "new" });
    expect(releases[1].verifiedOn.map((d) => d.id)).toEqual(["dpl_v1"]);
  });

  it("current Production: Production's own answer, else the API, else the last record -- never the newest record by guess", () => {
    const list = [dep("p1", "production", "b", "2026-10-01T00:00:00Z", { currentAt: "2026-10-02T00:00:00Z" }), dep("p2", "production", "d", "2026-10-03T00:00:00Z")];
    expect(currentProduction(list, { ok: true, deploymentId: "dpl_p2", gitSha: sha("d"), checkedAt: "t" }, null)).toMatchObject({ id: "dpl_p2", basis: "live" });
    expect(currentProduction(list, { ok: false, reason: "not_available" }, "dpl_p2")).toMatchObject({ id: "dpl_p2", basis: "api" });
    // p2 is newer but was never seen as current: the record says p1, with its time
    expect(currentProduction(list, { ok: false, reason: "not_available" }, null)).toMatchObject({ id: "dpl_p1", basis: "record", checkedAt: "2026-10-02T00:00:00Z" });
    expect(currentProduction([list[1]], { ok: false, reason: "unavailable" }, null)).toMatchObject({ id: null, basis: "unknown" });
  });

  it("current Preview: the API's alias, else this page's own deployment when opened through the fixed URL", () => {
    const list = [dep("v1", "preview", "d", "2026-10-02T00:00:00Z")];
    expect(currentPreview(list, "dpl_v1", null)).toMatchObject({ basis: "api", gitSha: sha("d") });
    expect(currentPreview(list, null, { id: "dpl_v1", viaAlias: true })).toMatchObject({ basis: "self" });
    expect(currentPreview(list, null, { id: "dpl_v1", viaAlias: false })).toMatchObject({ basis: "unknown" });
  });

  it("traces a commit to the first release and Preview containing it", () => {
    const list = [
      dep("v1", "preview", "c", "2026-10-02T00:00:00Z"),
      dep("p1", "production", "b", "2026-10-01T00:00:00Z"),
      dep("p2", "production", "d", "2026-10-03T00:00:00Z"),
      dep("u", "production", "z", "2026-10-04T00:00:00Z"),
    ];
    const t = traceCommit(sha("c"), list, graph);
    expect(t.production?.id).toBe("dpl_p2");
    expect(t.preview?.id).toBe("dpl_v1");
    expect(t.unknown).toBe(1);
    expect(traceCommit(sha("a"), list, graph).production?.id).toBe("dpl_p1");
  });

  it("merges records with the API: the API fills in, records Vercel no longer lists are kept as deleted", () => {
    const rec = (id: string, over: Partial<DeploymentRecordRow> = {}): DeploymentRecordRow => ({ ...dep(id, "preview", "a", "2026-10-01T00:00:00Z"), ...over });
    const merged = mergeDeployments([rec("old", { firstSeenAt: "2026-10-01T00:01:00Z" }), rec("both", { readyAt: null })], [
      { id: "dpl_both", target: "preview", url: "b.vercel.app", gitSha: sha("b"), gitMessage: "m", gitDirty: null, state: "READY", createdAt: "2026-10-05T00:00:00Z", readyAt: "2026-10-05T00:02:00Z" },
    ]);
    expect(merged.map((d) => [d.id, d.inVercel])).toEqual([
      ["dpl_both", true],
      ["dpl_old", false],
    ]);
    expect(merged[0]).toMatchObject({ readyAt: "2026-10-05T00:02:00Z", sources: ["cli", "api"] });
    expect(mergeDeployments([rec("old")], null)[0].inVercel).toBeNull();
  });
});
