import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/metrics/audience", () => ({ classifyActor: async (u: { isAdmin: boolean }) => ({ audience: u.isAdmin ? "internal" : "member", role: u.isAdmin ? "service" : "member", organizationId: null }) }));

// $executeRaw is a tagged template: keep its interpolated values so the
// batched JSON can be read back.
const executeCalls: unknown[][] = [];
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $executeRaw: vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
      executeCalls.push(values);
      return Promise.resolve(1);
    }),
    $queryRaw: vi.fn(async () => [{ "?column?": 1 }]),
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));
vi.mock("next/server", () => ({ after: () => {} }));
let user: { id: number; isAdmin: boolean } | null = null;
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => user }));

const { recordDaily, flushTimings } = await import("./record");

async function dailyWritten(): Promise<Record<string, number>> {
  executeCalls.length = 0;
  await flushTimings();
  const json = executeCalls[0]?.[0] as string | undefined;
  return Object.fromEntries(((json ? JSON.parse(json) : []) as { metric: string; value: number }[]).map((r) => [r.metric.replace(/^audience_v[23]\./, ""), r.value]));
}

describe("검색 통계: total plus a split by who searched", () => {
  it("keeps the total and adds anon / member / internal parts of the same events", async () => {
    user = null;
    recordDaily("search.keyword", ["lost", "지갑", 1]);
    await new Promise((r) => setTimeout(r, 0));
    user = { id: 1, isAdmin: false };
    recordDaily("search.keyword", ["lost", "우산", 2]);
    await new Promise((r) => setTimeout(r, 0));
    user = { id: 2, isAdmin: true };
    recordDaily("search.semantic", ["found", "검은 지갑", 3]);
    await new Promise((r) => setTimeout(r, 0));

    expect(await dailyWritten()).toEqual({
      "search.keyword.anon": 1,
      "search.keyword.member": 1,
      "search.semantic.internal": 1,
      "role.service.org.0.search.semantic.internal": 1,
    });
  });

  it("does not split other daily metrics, and a repeat within seconds is not counted again", async () => {
    user = null;
    recordDaily("recommend.shown");
    expect(await recordDaily("search.image", ["found", 100, {}])).toBe(true);
    expect(await recordDaily("search.image", ["found", 100, {}])).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(await dailyWritten()).toEqual({ "recommend.shown.anon": 1, "search.image.anon": 1 });
  });
  it("does not deduplicate different roles or accounts against each other", async () => {
    user = { id: 11, isAdmin: true }; await recordDaily("search.keyword", ["same-query"]);
    user = { id: 12, isAdmin: false }; await recordDaily("search.keyword", ["same-query"]);
    user = { id: 13, isAdmin: false }; await recordDaily("search.keyword", ["same-query"]);
    expect(await dailyWritten()).toEqual({ "search.keyword.internal": 1, "search.keyword.member": 2, "role.service.org.0.search.keyword.internal": 1 });
  });
});
