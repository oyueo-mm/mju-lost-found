import { beforeEach, describe, expect, it, vi } from "vitest";

// $queryRaw is a tagged template: keep each statement's SQL and values.
const queries: { sql: string; values: unknown[] }[] = [];
let wrote = 1;
let fail = false;
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({ sql: strings.join("?"), values });
      if (fail) throw new Error("db down");
      return [{ n: wrote }];
    }),
  },
}));
vi.mock("next/server", () => ({ after: () => {} }));

const { activityStep, LAST_ACTIVE_INTERVAL_MS } = await import("./activityTime");
const { activityActor, recordMemberActivity } = await import("./record");
const { prisma } = await import("@/lib/db/prisma");

// pending per-day counters are private to record.ts; read them through a
// flush into a mocked transaction
async function pendingCounters(): Promise<Record<string, number>> {
  const executeCalls: unknown[][] = [];
  const p = prisma as unknown as Record<string, unknown>;
  p.$executeRaw = vi.fn((_s: TemplateStringsArray, ...values: unknown[]) => (executeCalls.push(values), Promise.resolve(1)));
  p.$transaction = vi.fn(async (ops: unknown[]) => ops);
  const { flushTimings } = await import("./record");
  await flushTimings();
  const json = executeCalls.find((v) => typeof v[0] === "string" && (v[0] as string).startsWith("[{\"day\""))?.[0] as string | undefined;
  return Object.fromEntries(((json ? JSON.parse(json) : []) as { metric: string; value: number }[]).map((r) => [r.metric, r.value]));
}

beforeEach(async () => {
  queries.length = 0;
  wrote = 1;
  fail = false;
  await pendingCounters(); // start each test with nothing pending
});

describe("최근 활동 감지 시각: when a write happens (activityStep)", () => {
  const at = (iso: string) => new Date(iso);
  it("writes the first time, then at most every 5 minutes", () => {
    expect(LAST_ACTIVE_INTERVAL_MS).toBe(5 * 60 * 1000);
    expect(activityStep(null, at("2026-10-17T03:00:00Z"))).toEqual({ write: true, newDay: true, newHour: true });
    expect(activityStep(at("2026-10-17T03:00:00Z"), at("2026-10-17T03:04:59Z")).write).toBe(false);
    expect(activityStep(at("2026-10-17T03:00:00Z"), at("2026-10-17T03:05:00Z"))).toEqual({ write: true, newDay: false, newHour: false });
  });

  it("writes right away on a new KST hour and a new KST day (midnight KST = 15:00 UTC)", () => {
    expect(activityStep(at("2026-10-17T03:59:00Z"), at("2026-10-17T04:00:30Z"))).toEqual({ write: true, newDay: false, newHour: true });
    expect(activityStep(at("2026-10-17T14:59:30Z"), at("2026-10-17T15:00:10Z"))).toEqual({ write: true, newDay: true, newHour: true });
    // 23:30 UTC and 00:10 UTC are the same KST day (08~09시)
    expect(activityStep(at("2026-10-16T23:58:00Z"), at("2026-10-17T00:01:00Z")).newDay).toBe(false);
  });

  it("never moves a stored time back", () => {
    expect(activityStep(at("2026-10-17T03:10:00Z"), at("2026-10-17T03:00:00Z")).write).toBe(false);
  });
});

describe("recordMemberActivity", () => {
  const member = { id: 7, isAdmin: false };

  it("skips the database within the interval of the stored time", async () => {
    const now = new Date("2026-10-17T03:04:00Z");
    expect(await recordMemberActivity({ ...member, lastActiveAt: new Date("2026-10-17T03:00:00Z") }, now)).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it("writes one compare-and-set statement in UTC, without touching updated_at; marks the day and counts the hour", async () => {
    const last = new Date("2026-10-16T14:58:00.123Z"); // 23:58 KST the day before
    const now = new Date("2026-10-17T05:30:15.250Z"); // 14:30 KST
    expect(await recordMemberActivity({ ...member, lastActiveAt: last }, now)).toBe(true);
    expect(queries).toHaveLength(1);
    const [{ sql, values }] = queries;
    expect(sql).toContain(`UPDATE "User" SET "last_active_at" = (?::timestamptz AT TIME ZONE 'UTC')`);
    expect(sql).not.toContain("updated_at");
    expect(sql).toContain(`"deleted_at" IS NULL AND "withdrawn_at" IS NULL`);
    expect(sql).toContain(`"last_active_at" IS NOT DISTINCT FROM (?::timestamptz AT TIME ZONE 'UTC')`);
    expect(sql).toContain(`INSERT INTO "ActivityDay"`);
    expect(values).toEqual(["2026-10-17T05:30:15.250Z", 7, "2026-10-16T14:58:00.123Z", "2026-10-17", activityActor(7), true]);
    expect(await pendingCounters()).toEqual({ "active.member.hour.14": 1 });
  });

  it("a later write in the same hour updates the time but adds no day mark and no hour count", async () => {
    const now = new Date("2026-10-17T05:40:00Z");
    expect(await recordMemberActivity({ ...member, lastActiveAt: new Date("2026-10-17T05:30:00Z") }, now)).toBe(true);
    expect(queries[0].values.at(-1)).toBe(false); // no ActivityDay insert
    expect(await pendingCounters()).toEqual({});
  });

  it("the first record ever compares against NULL and counts the hour", async () => {
    expect(await recordMemberActivity({ ...member, lastActiveAt: null }, new Date("2026-10-17T00:00:00Z"))).toBe(true);
    expect(queries[0].values[2]).toBeNull();
    expect(await pendingCounters()).toEqual({ "active.member.hour.09": 1 });
  });

  it("counts nothing when another request wrote first or the account can't be updated (withdrawn / deactivated)", async () => {
    wrote = 0;
    expect(await recordMemberActivity({ ...member, lastActiveAt: null }, new Date("2026-10-17T00:00:00Z"))).toBe(false);
    expect(await pendingCounters()).toEqual({});
  });

  it("keeps admins' time but leaves them out of the hourly count", async () => {
    expect(await recordMemberActivity({ id: 1, isAdmin: true, lastActiveAt: null }, new Date("2026-10-17T00:00:00Z"))).toBe(true);
    expect(queries).toHaveLength(1);
    expect(await pendingCounters()).toEqual({});
  });

  it("never fails the caller when the database does", async () => {
    fail = true;
    expect(await recordMemberActivity({ ...member, lastActiveAt: null }, new Date("2026-10-17T00:00:00Z"))).toBe(false);
  });
});
