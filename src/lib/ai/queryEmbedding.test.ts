import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { embed } = vi.hoisted(() => ({ embed: vi.fn() }));
vi.mock("./embedding", () => ({ getEmbeddingProvider: () => ({ embed }) }));
beforeEach(() => { vi.resetModules(); embed.mockReset().mockResolvedValue([1, 0]); });
afterEach(() => vi.useRealTimers());
describe("warm query vector cache", () => {
  it("coalesces identical queries and reuses a vector across pages/filters", async () => {
    const { queryEmbedding } = await import("./queryEmbedding");
    const [a, b] = await Promise.all([queryEmbedding(" wallet "), queryEmbedding("wallet")]);
    expect(a).toEqual(b); expect(embed).toHaveBeenCalledOnce();
    await queryEmbedding("wallet"); expect(embed).toHaveBeenCalledOnce();
  });
  it("evicts failures and expires vectors", async () => {
    vi.useFakeTimers();
    const { queryEmbedding } = await import("./queryEmbedding");
    embed.mockRejectedValueOnce(new Error("temporary"));
    await expect(queryEmbedding("wallet")).rejects.toThrow("temporary");
    await queryEmbedding("wallet"); expect(embed).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(120001);
    await queryEmbedding("wallet"); expect(embed).toHaveBeenCalledTimes(3);
  });
  it("bounds memory instead of retaining arbitrary user queries forever", async () => {
    const { queryEmbedding } = await import("./queryEmbedding");
    for (let i = 0; i < 65; i++) await queryEmbedding(`query-${i}`);
    await queryEmbedding("query-0"); expect(embed).toHaveBeenCalledTimes(66);
  });
});
