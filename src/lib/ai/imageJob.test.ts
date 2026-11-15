import { beforeEach, describe, expect, it, vi } from "vitest";
const query = vi.fn(), execute = vi.fn(), txQuery = vi.fn(), txExecute = vi.fn(), user = vi.fn();
const transaction = vi.fn(async fn => fn({ $queryRaw: txQuery, $executeRaw: txExecute }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw: query, $executeRaw: execute, $transaction: transaction, user: { findUnique: user } } }));
const admission = vi.fn(), tier = vi.fn();
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: admission, rateLimitTierFor: tier }));
const embed = vi.fn(), invalidate = vi.fn();
vi.mock("./imageEmbedding", () => ({ IMAGE_EMBEDDING_DIMENSIONS: 768, getImageEmbeddingProvider: () => ({ embed }) }));
vi.mock("@/lib/recommendation/service", () => ({ invalidateRecommendationCache: invalidate }));
const { runImageJob, imageInputHash } = await import("./imageJob");
const url = "https://swqvlihgupranzfzjevb.supabase.co/storage/v1/object/public/post-images/posts/lost/1/a.jpg";
let lease: string;
const job = () => ({ post_type: "lost", post_id: 1, owner_id: 7, generation: 1, desired_hash: imageInputHash(url), completed_hash: null, state: "pending", lease_token: lease, lease_valid: true, attempts: 1 });
beforeEach(() => {
  for (const mock of [query, execute, txQuery, txExecute, user, admission, tier, embed, invalidate, transaction]) mock.mockReset();
  transaction.mockImplementation(async fn => fn({ $queryRaw: txQuery, $executeRaw: txExecute }));
  query.mockResolvedValueOnce([{ image_url: url, user_id: 7, has_vector: false, worker_ready: true }]).mockResolvedValueOnce([job()]).mockImplementationOnce(async (_sql, token) => { lease = token; return [job()]; });
  txQuery.mockResolvedValueOnce([{ image_url: url }]).mockImplementationOnce(async () => [job()]);
  user.mockResolvedValue({ id: 7, isAdmin: false, deletedAt: null, withdrawnAt: null, isSuspended: false });
  admission.mockResolvedValue({ ok: true }); tier.mockResolvedValue("user");
  embed.mockResolvedValue(Array.from({ length: 768 }, (_, i) => i === 0 ? 1 : 0));
  execute.mockResolvedValue(1); txExecute.mockResolvedValue(1);
});
describe("controlled image embedding", () => {
  it("computes compatible vectors and invalidates cache only after fenced commit", async () => {
    expect(await runImageJob("lost", 1, true)).toEqual({ status: "completed" });
    expect(embed).toHaveBeenCalledWith(url); expect(txExecute).toHaveBeenCalledTimes(3);
    expect(invalidate).toHaveBeenCalledWith("lost", 1, expect.any(Object));
    expect(invalidate.mock.invocationCallOrder[0]).toBeGreaterThan(txExecute.mock.invocationCallOrder[1]);
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(txExecute.mock.invocationCallOrder[2]);
  });
  it("reuses a completed current input without budget or inference", async () => {
    query.mockReset().mockResolvedValueOnce([{ image_url: url, user_id: 7, has_vector: true, worker_ready: true }]).mockResolvedValueOnce([{ ...job(), completed_hash: imageInputHash(url), state: "completed" }]);
    expect(await runImageJob("lost", 1)).toEqual({ status: "reused" });
    expect(embed).not.toHaveBeenCalled(); expect(admission).not.toHaveBeenCalled();
  });
  it("coalesces an active lease without inference or budget", async () => {
    query.mockReset().mockResolvedValueOnce([{ image_url: url, user_id: 7, worker_ready: true }]).mockResolvedValueOnce([job()]).mockResolvedValueOnce([]);
    expect(await runImageJob("lost", 1)).toEqual({ status: "in_progress" }); expect(embed).not.toHaveBeenCalled(); expect(admission).not.toHaveBeenCalled();
  });
  it("keeps work pending without admission or inference during deployment drain", async () => {
    query.mockReset().mockResolvedValueOnce([{ image_url: url, user_id: 7, worker_ready: false }]);
    expect(await runImageJob("lost", 1, true)).toEqual({ status: "pending" });
    expect(execute).not.toHaveBeenCalled(); expect(embed).not.toHaveBeenCalled(); expect(admission).not.toHaveBeenCalled();
  });
  it.each(["limited", "unavailable"])("never infers when admission is %s", async reason => {
    admission.mockResolvedValueOnce({ ok: false, reason, retryAfterSeconds: 5 });
    expect(await runImageJob("lost", 1)).toMatchObject({ status: "limited", admission: { reason } });
    expect(embed).not.toHaveBeenCalled(); expect(txExecute).not.toHaveBeenCalled();
  });
  it("discards a result when the source changed during inference", async () => {
    txQuery.mockReset().mockResolvedValueOnce([{ image_url: url + "changed" }]).mockImplementationOnce(async () => [job()]);
    expect(await runImageJob("lost", 1)).toEqual({ status: "stale" });
    expect(txExecute).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
  });
  it("discards a superseded generation even if the URL is the same again", async () => {
    txQuery.mockReset().mockResolvedValueOnce([{ image_url: url }]).mockImplementationOnce(async () => [{ ...job(), generation: 3 }]);
    expect(await runImageJob("lost", 1)).toEqual({ status: "stale" }); expect(txExecute).not.toHaveBeenCalled();
  });
  it("does not claim success or invalidate on inference failure", async () => {
    embed.mockRejectedValueOnce(new Error("model failed"));
    expect(await runImageJob("lost", 1)).toEqual({ status: "failed" }); expect(txExecute).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
  });
  it("rejects incompatible vector dimensions", async () => {
    embed.mockResolvedValueOnce([1]); expect(await runImageJob("lost", 1)).toEqual({ status: "failed" }); expect(txExecute).not.toHaveBeenCalled();
  });
  it("does not allow an expired worker to commit", async () => {
    txQuery.mockReset().mockResolvedValueOnce([{ image_url: url }]).mockImplementationOnce(async () => [{ ...job(), lease_valid: false }]);
    expect(await runImageJob("lost", 1)).toEqual({ status: "stale" }); expect(txExecute).not.toHaveBeenCalled();
  });
  it("never infers for an owner suspended after enqueue", async () => {
    user.mockResolvedValueOnce({ id: 7, isSuspended: true, suspendedUntil: null });
    expect(await runImageJob("lost", 1)).toEqual({ status: "failed" }); expect(embed).not.toHaveBeenCalled();
  });
});
