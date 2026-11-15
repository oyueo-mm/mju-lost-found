import { afterEach, beforeEach, expect, it, vi } from "vitest";
const query = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw: query } }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: vi.fn(), rateLimitTierFor: vi.fn() }));
vi.mock("./imageEmbedding", () => ({ IMAGE_EMBEDDING_DIMENSIONS: 768, getImageEmbeddingProvider: vi.fn() }));
vi.mock("@/lib/recommendation/service", () => ({ invalidateRecommendationCache: vi.fn() }));
beforeEach(() => { vi.resetModules(); query.mockReset().mockResolvedValue([]); vi.spyOn(Date, "now").mockReturnValue(100000); });
afterEach(() => { vi.restoreAllMocks(); });
it("coalesces concurrent recovery and skips reads during the 15-second interval", async () => {
  const { recoverImageJobsAfterRequest, drainImageJobs } = await import("./imageJob");
  await Promise.all(Array.from({ length: 20 }, () => recoverImageJobsAfterRequest()));
  await recoverImageJobsAfterRequest();
  expect(query).toHaveBeenCalledTimes(1);
  await drainImageJobs(8); // authenticated maintenance must still be immediate
  expect(query).toHaveBeenCalledTimes(2);
  vi.mocked(Date.now).mockReturnValue(115000);
  await recoverImageJobsAfterRequest();
  expect(query).toHaveBeenCalledTimes(3);
});
it("releases failed recovery and retries after the bounded interval", async () => {
  query.mockRejectedValueOnce(new Error("unavailable"));
  const { recoverImageJobsAfterRequest } = await import("./imageJob");
  await expect(recoverImageJobsAfterRequest()).rejects.toThrow("unavailable");
  await recoverImageJobsAfterRequest();
  expect(query).toHaveBeenCalledTimes(1);
  vi.mocked(Date.now).mockReturnValue(115000);
  await recoverImageJobsAfterRequest();
  expect(query).toHaveBeenCalledTimes(2);
});
