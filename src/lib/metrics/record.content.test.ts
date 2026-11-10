import { describe, expect, it, vi } from "vitest";
import { CONTENT_FIRST, CONTENT_PREFIX } from "./contentMeasurement";

type Statement = { sql: string; values: unknown[] };
const statements: Statement[] = [], batches: Statement[][] = [];
let fail = false;
let duringCommit: (() => void) | undefined;
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  $queryRaw: async () => [{ "?column?": 1 }],
  $executeRaw: (s: TemplateStringsArray, ...values: unknown[]) => { statements.push({ sql: s.join("?"), values }); return Promise.resolve(1); },
  $transaction: async (ops: unknown[]) => { batches.push(statements.splice(0)); duringCommit?.(); duringCommit = undefined; if (fail) { fail = false; throw new Error("write failed"); } return ops; },
} }));
vi.mock("next/server", () => ({ after: () => {} }));
const { addDailyCount, addDailyMinimum, flushTimings } = await import("./record");
const payload = (batch: Statement[], minimum: boolean) => JSON.parse(batch.find(s => s.sql.includes(minimum ? "LEAST(\"MetricDaily\".\"value\"" : '"value" + EXCLUDED."value"'))!.values[0] as string);

describe("Content first observation atomic persistence", () => {
  it("commits marker and counters in one transaction; retries keep the minimum and count each batch once", async () => {
    addDailyCount(CONTENT_PREFIX + "h_jonghap_guard_reg");
    addDailyMinimum(CONTENT_FIRST, 500, "2026-11-10");
    addDailyMinimum(CONTENT_FIRST, 400, "2026-11-10");
    fail = true;
    await expect(flushTimings()).rejects.toThrow("write failed");
    expect(payload(batches.at(-1)!, true)).toEqual([{ day: "2026-11-10", metric: CONTENT_FIRST, value: 400 }]);
    await flushTimings();
    const committed = batches.at(-1)!;
    expect(payload(committed, true)[0].value).toBe(400);
    expect(payload(committed, false)).toContainEqual(expect.objectContaining({ metric: "audience_v3." + CONTENT_PREFIX + "h_jonghap_guard_reg", value: 1 }));
    expect(committed.some(s => s.sql.includes('"ApiMetricHourly"'))).toBe(true);
    const batchCount = batches.length;
    await flushTimings();
    expect(batches).toHaveLength(batchCount);
  });
  it("does not lose an earlier observation queued while a failed flush was in flight", async () => {
    addDailyCount(CONTENT_PREFIX + "h_jonghap_guard_reg");
    addDailyMinimum(CONTENT_FIRST, 800, "2026-11-11");
    duringCommit = () => { addDailyCount(CONTENT_PREFIX + "h_jonghap_guard_reg"); addDailyMinimum(CONTENT_FIRST, 600, "2026-11-11"); };
    fail = true;
    await expect(flushTimings()).rejects.toThrow("write failed");
    await flushTimings();
    expect(payload(batches.at(-1)!, true)[0].value).toBe(600);
    expect(payload(batches.at(-1)!, false)).toContainEqual(expect.objectContaining({ metric: "audience_v3." + CONTENT_PREFIX + "h_jonghap_guard_reg", value: 2 }));
  });
});
