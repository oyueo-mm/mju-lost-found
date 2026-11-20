import { beforeEach, describe, expect, it, vi } from "vitest";

// Function Storage C-2: the text job worker. Prisma is mocked; the claim,
// fence and commit SQL run for real in scripts/operations/verify-text-jobs.mjs
// against the Preview database.
const query = vi.fn(), execute = vi.fn(), txQuery = vi.fn(), txExecute = vi.fn();
const transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: txQuery, $executeRaw: txExecute }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw: query, $executeRaw: execute, $transaction: transaction } }));
const embed = vi.fn(), invalidate = vi.fn();
vi.mock("./embedding", async (importOriginal) => ({ ...(await importOriginal<typeof import("./embedding")>()), getEmbeddingProvider: () => ({ embed }) }));
vi.mock("@/lib/recommendation/service", () => ({ invalidateRecommendationCache: invalidate }));
const { runTextJob, drainTextJobs, TEXT_JOB_TOKEN_PREFIX } = await import("./textJob");

const source = { title: "검은 지갑", description: "도서관 2층", category: "지갑", location: "중앙도서관" };
const vector = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
let token = "";
const sqlText = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?");
const active = (over: Record<string, unknown> = {}) => [{ generation: 3, lease_token: token, lease_valid: true, ...over }];

beforeEach(() => {
  for (const mock of [query, execute, txQuery, txExecute, embed, invalidate]) mock.mockReset();
  transaction.mockClear();
  // claim (captures the lease token), then the source read
  query.mockImplementationOnce(async (...args: unknown[]) => { token = args.find((a) => typeof a === "string" && a.startsWith(TEXT_JOB_TOKEN_PREFIX)) as string; return [{ generation: 3 }]; })
    .mockResolvedValueOnce([source]);
  txQuery.mockResolvedValueOnce([source]).mockImplementationOnce(async () => active());
  embed.mockResolvedValue(vector);
  execute.mockResolvedValue(1); txExecute.mockResolvedValue(1);
});

describe("text embedding job", () => {
  it("embeds the stored text and saves it, then invalidates the cache, then completes -- in one fenced commit", async () => {
    expect(await runTextJob("lost", 7)).toEqual({ status: "completed" });
    expect(embed).toHaveBeenCalledWith("검은 지갑 도서관 2층 지갑 중앙도서관");
    expect(txExecute).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith("lost", 7, expect.any(Object));
    expect(invalidate.mock.invocationCallOrder[0]).toBeGreaterThan(txExecute.mock.invocationCallOrder[0]);
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(txExecute.mock.invocationCallOrder[1]);
    expect(sqlText(txExecute.mock.calls[1])).toContain("state='completed',completed_generation=generation");
  });

  it("claims with a lease, retry limit and backoff window", async () => {
    await runTextJob("found", 7);
    const claim = sqlText(query.mock.calls[0]);
    expect(claim).toContain("lease_until=(now() AT TIME ZONE 'UTC')+");
    expect(claim).toContain("attempts<");
    expect(claim).toContain("next_run_at <= (now() AT TIME ZONE 'UTC')");
    expect(claim).toContain("(lease_until IS NULL OR lease_until < (now() AT TIME ZONE 'UTC'))");
    expect(query.mock.calls[0]).toContain(5);
  });

  it("does nothing while another worker holds the lease (no duplicate inference)", async () => {
    query.mockReset().mockResolvedValueOnce([]);
    expect(await runTextJob("lost", 7)).toEqual({ status: "in_progress" });
    expect(embed).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("drops a late result when a newer edit bumped the generation", async () => {
    txQuery.mockReset().mockResolvedValueOnce([source]).mockImplementationOnce(async () => active({ generation: 4 }));
    expect(await runTextJob("lost", 7)).toEqual({ status: "stale" });
    expect(txExecute).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
    // the lease is handed back so the newer generation runs next
    expect(sqlText(execute.mock.calls.at(-1)!)).toContain("state=CASE WHEN state='running' THEN 'pending' ELSE state END");
  });

  it("drops a result whose text changed before commit", async () => {
    txQuery.mockReset().mockResolvedValueOnce([{ ...source, title: "갈색 지갑" }]).mockImplementationOnce(async () => active());
    expect(await runTextJob("lost", 7)).toEqual({ status: "stale" });
    expect(txExecute).not.toHaveBeenCalled();
  });

  it("drops a result after its lease expired or was taken over", async () => {
    txQuery.mockReset().mockResolvedValueOnce([source]).mockImplementationOnce(async () => active({ lease_valid: false }));
    expect(await runTextJob("lost", 7)).toEqual({ status: "stale" });
    txQuery.mockReset().mockResolvedValueOnce([source]).mockImplementationOnce(async () => active({ lease_token: "text-v1:other" }));
    query.mockImplementationOnce(async (...args: unknown[]) => { token = args.find((a) => typeof a === "string" && a.startsWith(TEXT_JOB_TOKEN_PREFIX)) as string; return [{ generation: 3 }]; }).mockResolvedValueOnce([source]);
    expect(await runTextJob("lost", 7)).toEqual({ status: "stale" });
    expect(txExecute).not.toHaveBeenCalled();
  });

  it("marks the claimed generation failed with a 10 s backoff when inference fails, keeping the old vector", async () => {
    embed.mockRejectedValueOnce(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runTextJob("lost", 7)).toEqual({ status: "failed" });
    expect(transaction).not.toHaveBeenCalled();
    const fail = execute.mock.calls.find((call) => sqlText(call).includes("'failed'"))!;
    expect(sqlText(fail)).toContain("CASE WHEN generation=? THEN 'failed' ELSE state END");
    expect(sqlText(fail)).toContain("interval '10 seconds'");
    expect(fail).toContain(3);
    error.mockRestore();
  });

  it("rejects a malformed vector without writing", async () => {
    embed.mockResolvedValueOnce([1, 2, 3]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runTextJob("lost", 7)).toEqual({ status: "failed" });
    expect(transaction).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("skips a deleted post without inference", async () => {
    query.mockReset().mockResolvedValueOnce([{ generation: 3 }]).mockResolvedValueOnce([]);
    expect(await runTextJob("lost", 7)).toEqual({ status: "missing" });
    expect(embed).not.toHaveBeenCalled();
  });

  it("drains at most eight due jobs per call", async () => {
    query.mockReset().mockResolvedValueOnce([]);
    await drainTextJobs(50);
    expect(query.mock.calls[0]).toContain(8);
  });
});
