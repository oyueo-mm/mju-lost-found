import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));
const executed: unknown[][] = [];
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $executeRaw: async (_s: TemplateStringsArray, ...values: unknown[]) => {
      executed.push(values);
      return 1;
    },
  },
}));

const { fromVercel, inspectorUrl } = await import("./vercelDeployment.mjs");
const { fetchVercelFeed, storeVercelFeed } = await import("./vercel");
const { fetchLiveVersion } = await import("./live");
const { runtimeDeployment } = await import("./deployments");
const { deployStats } = await import("./dashboard");

const SHA = "8565d610fc9d2034d3fbff3fabc8541089d119e2";
// the shape GET /v6/deployments returned on 2026-10-19 (personal fields left out)
const listed = {
  uid: "dpl_9ums5Xw4eLiATXV46UEV4ARMJLAr",
  url: "mju-lost-found-vercel-6fldllz3m-oyueo.vercel.app",
  created: 1792400905755,
  createdAt: 1792400905755,
  ready: 1792400989395,
  state: "READY",
  readyState: "READY",
  target: null,
  source: "cli",
  meta: { githubCommitSha: SHA, githubCommitMessage: "feat(admin): 개발자 통계 tab\n\nbody", githubCommitAuthorEmail: "someone@example.com" },
  creator: { email: "someone@example.com" },
};

beforeEach(() => {
  executed.length = 0;
  delete process.env.VERCEL_TEAM_ID;
});

describe("Vercel 배포", () => {
  it("keeps only the deployment fields, never the author's e-mail or the creator", () => {
    const row = fromVercel(listed);
    expect(row).toEqual({
      id: "dpl_9ums5Xw4eLiATXV46UEV4ARMJLAr",
      target: "preview",
      url: "mju-lost-found-vercel-6fldllz3m-oyueo.vercel.app",
      gitSha: SHA,
      gitMessage: "feat(admin): 개발자 통계 tab",
      gitDirty: null,
      state: "READY",
      createdAt: "2026-10-19T09:08:25.755Z",
      readyAt: "2026-10-19T09:09:49.395Z",
    });
    expect(JSON.stringify(row)).not.toContain("example.com");
    expect(fromVercel({ ...listed, target: "production", meta: { gitDirty: "1" } })).toMatchObject({ target: "production", gitSha: null, gitMessage: null, gitDirty: true });
    // a failed build has no ready time of its own
    expect(fromVercel({ ...listed, readyState: "ERROR", state: "ERROR" })).toMatchObject({ state: "ERROR", readyAt: null });
    expect(fromVercel({ uid: "nope" })).toBeNull();
    expect(inspectorUrl("dpl_9ums5Xw4eLiATXV46UEV4ARMJLAr")).toBe("https://vercel.com/oyueo/mju-lost-found-vercel/9ums5Xw4eLiATXV46UEV4ARMJLAr");
  });

  it("does nothing without a token, and reads only the production id from the project", async () => {
    expect(await fetchVercelFeed(vi.fn(), undefined)).toEqual({ ok: false, reason: "no_token" });
    process.env.VERCEL_TEAM_ID = "team_x";
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v6/deployments")) return Response.json({ deployments: [listed], pagination: { next: null } });
      if (url.includes("/v9/projects/")) return Response.json({ targets: { production: { id: "dpl_prod" } }, env: [{ value: "secret" }] });
      return Response.json({ deploymentId: listed.uid });
    });
    const feed = await fetchVercelFeed(fetcher, "tok");
    expect(feed).toMatchObject({ ok: true, productionId: "dpl_prod", previewAliasId: listed.uid });
    expect(JSON.stringify(feed)).not.toContain("secret");
    for (const [input, init] of fetcher.mock.calls) {
      expect(new URL(String(input)).host).toBe("api.vercel.com");
      expect(String(input)).not.toContain("tok");
      expect(new URL(String(input)).searchParams.get("teamId")).toBe("team_x");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    }
    expect(await fetchVercelFeed(vi.fn<typeof fetch>(async () => new Response("", { status: 403 })), "tok")).toEqual({ ok: false, reason: "unauthorized" });

    // stored, the live ones marked as current at the fetch time
    if (feed.ok) await storeVercelFeed(feed);
    expect(executed).toHaveLength(1);
    expect(executed[0]).toContain(listed.uid);
    expect(executed[0]).toContain("api");
  });

  it("reads Production's /api/version; before it exists the version is not available", async () => {
    expect(await fetchLiveVersion(vi.fn<typeof fetch>(async () => new Response("", { status: 404 })))).toEqual({ ok: false, reason: "not_available" });
    expect(
      await fetchLiveVersion(vi.fn<typeof fetch>(async () => Response.json({ deploymentId: "dpl_a", environment: "preview", gitSha: SHA }))),
    ).toEqual({ ok: false, reason: "unavailable" });
    const ok = await fetchLiveVersion(vi.fn<typeof fetch>(async () => Response.json({ deploymentId: "dpl_a", environment: "production", gitSha: SHA })));
    expect(ok).toMatchObject({ ok: true, deploymentId: "dpl_a", gitSha: SHA });
  });

  it("a deployment describes itself from Vercel's system variables, and nothing locally", () => {
    const now = new Date("2026-10-19T10:00:00Z");
    expect(runtimeDeployment({ VERCEL_DEPLOYMENT_ID: "dpl_x", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_GIT_COMMIT_MESSAGE: "a\nb", VERCEL_URL: "x.vercel.app" }, now)).toEqual({
      id: "dpl_x",
      target: "preview",
      url: "x.vercel.app",
      gitSha: SHA,
      gitMessage: "a",
      state: "READY",
      firstSeenAt: "2026-10-19T10:00:00.000Z",
    });
    expect(runtimeDeployment({ VERCEL_DEPLOYMENT_ID: "dpl_x", VERCEL_ENV: "development" })).toBeNull();
    expect(runtimeDeployment({})).toBeNull();
    expect(runtimeDeployment({ VERCEL_DEPLOYMENT_ID: "dpl_x", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "" })).toMatchObject({ gitSha: null, gitMessage: null });
  });

  it("counts finished builds per environment, failures apart, by KST day", () => {
    const d = (target: "production" | "preview", state: string, createdAt: string) =>
      ({ id: createdAt, target, state, createdAt, firstSeenAt: null }) as never;
    const s = deployStats(
      [
        d("production", "READY", "2026-10-18T16:00:00Z"), // 10-19 KST
        d("preview", "READY", "2026-10-18T14:00:00Z"), // 10-18 KST
        d("preview", "ERROR", "2026-10-18T15:30:00Z"), // 10-19 KST
        d("preview", "BUILDING", "2026-10-18T15:40:00Z"),
        d("production", "READY", "2026-10-01T00:00:00Z"), // before the period
      ],
      { from: "2026-10-18", to: "2026-10-19", days: null },
      "day",
      ["2026-10-18", "2026-10-19"],
      "2026-10-17",
    );
    expect(s.production).toEqual([0, 1]);
    expect(s.preview).toEqual([1, 0]);
    expect(s.failed).toEqual([0, 1]);
    expect(s.totals).toEqual({ production: 1, preview: 1, failed: 1, finished: 3, unknownState: 1 });
    expect(s.successRate).toBeCloseTo(2 / 3);
    expect(s.coverage).toEqual(["full", "full"]);
    expect(s.beforeRecords).toBe(false);
  });

  it("before the first recorded deployment nothing is known: 미측정, not 0", () => {
    const s = deployStats([], { from: "2026-10-01", to: "2026-10-31", days: null }, "week", ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"], "2026-10-17");
    expect(s.coverage).toEqual(["none", "none", "partial", "full", "full"]);
    expect(s.beforeRecords).toBe(true);
    expect(deployStats([], { from: "2026-10-01", to: "2026-10-02", days: null }, "day", ["2026-10-01", "2026-10-02"], null).coverage).toEqual(["none", "none"]);
    // chosen days only
    const d = (createdAt: string) => ({ id: createdAt, target: "preview", state: "READY", createdAt, firstSeenAt: null }) as never;
    const only = deployStats([d("2026-10-18T01:00:00Z"), d("2026-10-19T01:00:00Z")], { from: "2026-10-18", to: "2026-10-20", days: ["2026-10-18", "2026-10-20"] }, "day", ["2026-10-18", "2026-10-20"], "2026-10-17");
    expect(only.preview).toEqual([1, 0]);
    expect(only.totals.preview).toBe(1);
  });
});
