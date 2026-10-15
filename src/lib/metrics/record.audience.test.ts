import { describe, expect, it, vi } from "vitest";

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
let user: { isAdmin: boolean } | null = null;
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => user }));

const { recordDaily, flushTimings } = await import("./record");

async function dailyWritten(): Promise<Record<string, number>> {
  executeCalls.length = 0;
  await flushTimings();
  const json = executeCalls[0]?.[0] as string | undefined;
  return Object.fromEntries(((json ? JSON.parse(json) : []) as { metric: string; value: number }[]).map((r) => [r.metric, r.value]));
}

describe("검색 통계: total plus a split by who searched", () => {
  it("keeps the total and adds anon / member / internal parts of the same events", async () => {
    user = null;
    recordDaily("search.keyword", ["lost", "지갑", 1]);
    await new Promise((r) => setTimeout(r, 0));
    user = { isAdmin: false };
    recordDaily("search.keyword", ["lost", "우산", 2]);
    await new Promise((r) => setTimeout(r, 0));
    user = { isAdmin: true };
    recordDaily("search.semantic", ["found", "검은 지갑", 3]);
    await new Promise((r) => setTimeout(r, 0));

    expect(await dailyWritten()).toEqual({
      "search.keyword": 2,
      "search.keyword.anon": 1,
      "search.keyword.member": 1,
      "search.semantic": 1,
      "search.semantic.internal": 1,
    });
  });

  it("does not split other daily metrics, and a repeat within seconds is not counted again", async () => {
    user = null;
    recordDaily("recommend.shown");
    expect(recordDaily("search.image", ["found", 100, {}])).toBe(true);
    expect(recordDaily("search.image", ["found", 100, {}])).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(await dailyWritten()).toEqual({ "recommend.shown": 1, "search.image": 1, "search.image.anon": 1 });
  });
});
