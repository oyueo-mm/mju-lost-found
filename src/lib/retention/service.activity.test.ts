import { describe, expect, it, vi } from "vitest";

// The daily run with an empty database except the withdrawn accounts it
// reads: every other query finds nothing.
let withdrawn: { id: number }[] = [];
const empty = (model: string, method: string) =>
  method === "findMany" ? (model === "user" ? withdrawn.map((w) => ({ ...w, withdrawnAt: new Date("2026-10-01T00:00:00Z"), isSuspended: false, suspendedUntil: null, _count: { withdrawnIdentities: 0 } })) : []) : method === "count" ? 0 : method.startsWith("find") ? null : { count: 0 };
vi.mock("@/lib/db/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, model: string) =>
        model === "$queryRaw" || model === "$executeRaw" ? async () => [] : model === "$transaction" ? async (fn: (tx: unknown) => unknown) => fn(undefined) : new Proxy({}, { get: (_m, method: string) => async () => empty(model, method) }),
    },
  ),
}));
vi.mock("@/lib/auth/identityRelease", () => ({ releaseResolvedWithdrawnIdentities: async () => [] }));
vi.mock("@/lib/images/chatStorage", () => ({ deleteChatImageSafely: vi.fn() }));
vi.mock("@/lib/posts/service", () => ({ deletePostDerivedDataInTx: vi.fn(), deletePostRowInTx: vi.fn(), deletePostStorageObjects: vi.fn() }));
const deleteActivityMarks = vi.fn(async (_db: unknown, ids: number[]) => ids.length * 2);
vi.mock("@/lib/metrics/record", () => ({ deleteActivityMarks }));

const { runRetention } = await import("./service");
const { prisma } = await import("@/lib/db/prisma");

describe("runRetention: 탈퇴 회원의 이용 일자 기록", () => {
  it("deletes the marks of every withdrawn account, and of no one else", async () => {
    withdrawn = [{ id: 3 }, { id: 11 }];
    const result = await runRetention(new Date("2026-10-16T18:00:00Z"));
    expect(deleteActivityMarks).toHaveBeenCalledTimes(1);
    const [db, ids] = deleteActivityMarks.mock.calls[0];
    expect(db).toBe(prisma);
    expect(ids).toEqual([3, 11]);
    expect(result.withdrawnActivityDeleted).toBe(4);
  });

  it("asks for nothing when no account was withdrawn", async () => {
    deleteActivityMarks.mockClear();
    withdrawn = [];
    const result = await runRetention(new Date("2026-10-16T18:00:00Z"));
    expect(deleteActivityMarks.mock.calls[0][1]).toEqual([]);
    expect(result.withdrawnActivityDeleted).toBe(0);
  });
});
