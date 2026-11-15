import { beforeEach, describe, expect, it, vi } from "vitest";

// Release C (M-1): the daily run's report-snapshot step, with no withdrawn
// accounts. Every query not set up below finds nothing.
type Row = { id: number; targetSnapshot: unknown };
let due: Row[] = [];
let users: Record<number, { isSuspended: boolean; suspendedUntil: Date | null; _count: { withdrawnIdentities: number } }> = {};
let recentViews: Record<number, number> = {};
const calls: { model: string; method: string; args: unknown }[] = [];

function answer(model: string, method: string, args: { where?: { id?: number; reportId?: number } } | undefined) {
  if (model === "report" && method === "findMany") return due;
  if (model === "user" && method === "findUnique") return users[args?.where?.id ?? -1] ?? null;
  if ((model === "adminAccessLog" || model === "identityAccessLog") && method === "count") return model === "adminAccessLog" ? (recentViews[args?.where?.reportId ?? -1] ?? 0) : 0;
  if (method === "findMany") return [];
  if (method === "count") return 0;
  if (method.startsWith("find")) return null;
  return { count: 0 };
}

vi.mock("@/lib/db/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, model: string) =>
        model === "$queryRaw" || model === "$executeRaw"
          ? async () => []
          : model === "$transaction"
            ? async (fn: (tx: unknown) => unknown) => fn(undefined)
            : new Proxy({}, { get: (_m, method: string) => async (args: never) => (calls.push({ model, method, args }), answer(model, method, args)) }),
    },
  ),
}));
vi.mock("@/lib/auth/identityRelease", () => ({ releaseResolvedWithdrawnIdentities: async () => [] }));
vi.mock("@/lib/images/chatStorage", () => ({ deleteChatImageSafely: vi.fn() }));
vi.mock("@/lib/posts/service", () => ({ deletePostDerivedDataInTx: vi.fn(), deletePostRowInTx: vi.fn(), deletePostStorageObjects: vi.fn() }));
vi.mock("@/lib/metrics/record", () => ({ deleteActivityMarks: vi.fn(async () => 0) }));
const removeReportEvidence = vi.fn(async () => true);
vi.mock("@/lib/report/evidenceStorage", () => ({ removeReportEvidence }));
const purgeReportSnapshot = vi.fn(async () => true);
vi.mock("@/lib/report/snapshot", async () => {
  const actual = await vi.importActual<typeof import("@/lib/report/snapshot")>("@/lib/report/snapshot");
  return { readSnapshot: actual.readSnapshot, purgeReportSnapshot };
});

const { runRetention } = await import("./service");
const NOW = new Date("2026-11-15T18:00:00Z");
const snap = (subjectUserId: number) => ({ v: 1, subjectUserId, target: { kind: "comment", content: "x" }, images: [] });
const active = { isSuspended: false, suspendedUntil: null, _count: { withdrawnIdentities: 0 } };

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  due = [];
  users = {};
  recentViews = {};
  purgeReportSnapshot.mockResolvedValue(true);
});

describe("runRetention: report snapshots (release C)", () => {
  it("asks only for processed reports with a snapshot, processed at least a year ago", async () => {
    await runRetention(NOW);
    const query = calls.find((c) => c.model === "report" && c.method === "findMany" && JSON.stringify(c.args).includes("targetSnapshot"));
    const where = (query?.args as { where: Record<string, unknown> }).where;
    expect(where.status).toEqual({ not: "PENDING" });
    expect(where.processedAt).toEqual({ lte: new Date("2025-11-15T18:00:00Z") });
    expect(where.NOT).toBeDefined();
  });

  it("purges the snapshot of a closed matter, keeping the report row", async () => {
    due = [{ id: 7, targetSnapshot: snap(2) }];
    users = { 2: active };
    const result = await runRetention(NOW);
    expect(purgeReportSnapshot).toHaveBeenCalledWith(7, NOW);
    expect(result.reportSnapshotsPurged).toBe(1);
    expect(calls.some((c) => c.model === "report" && c.method === "delete")).toBe(false);
  });

  it("keeps it while the person it is about is still suspended or on a withdrawn hold", async () => {
    due = [
      { id: 7, targetSnapshot: snap(2) },
      { id: 8, targetSnapshot: snap(3) },
      { id: 9, targetSnapshot: snap(4) },
    ];
    users = {
      2: { ...active, isSuspended: true }, // permanent
      3: { ...active, isSuspended: true, suspendedUntil: new Date("2026-12-01T00:00:00Z") },
      4: { ...active, _count: { withdrawnIdentities: 1 } },
    };
    const result = await runRetention(NOW);
    expect(purgeReportSnapshot).not.toHaveBeenCalled();
    expect(result.reportSnapshotsDeferred).toBe(3);
  });

  it("an expired timed suspension no longer holds it", async () => {
    due = [{ id: 7, targetSnapshot: snap(2) }];
    users = { 2: { ...active, isSuspended: true, suspendedUntil: new Date("2026-01-01T00:00:00Z") } };
    await runRetention(NOW);
    expect(purgeReportSnapshot).toHaveBeenCalledWith(7, NOW);
  });

  it("keeps it while the report was viewed within the last year", async () => {
    due = [{ id: 7, targetSnapshot: snap(2) }];
    users = { 2: active };
    recentViews = { 7: 1 };
    const result = await runRetention(NOW);
    expect(purgeReportSnapshot).not.toHaveBeenCalled();
    expect(result.reportSnapshotsDeferred).toBe(1);
  });

  it("counts a purge whose evidence couldn't be removed as deferred (retried next run)", async () => {
    due = [{ id: 7, targetSnapshot: snap(2) }];
    users = { 2: active };
    purgeReportSnapshot.mockResolvedValueOnce(false);
    const result = await runRetention(NOW);
    expect(result.reportSnapshotsPurged).toBe(0);
    expect(result.reportEvidenceDeferred).toBe(1);
  });

  it("still purges a snapshot whose subject account no longer exists", async () => {
    due = [{ id: 7, targetSnapshot: snap(99) }];
    await runRetention(NOW);
    expect(purgeReportSnapshot).toHaveBeenCalledWith(7, NOW);
  });
});
