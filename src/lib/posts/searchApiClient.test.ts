import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPostsFromApi } from "./searchApiClient";

afterEach(() => vi.unstubAllGlobals());

describe("browser semantic search transport", () => {
  it("uses the existing same-origin session, preserves filters and revives dates", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ type: "lost", id: 1, createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z", lostAt: null }],
      pagination: { page: 2, limit: 1, total: 3, totalPages: 3 },
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const result = await fetchPostsFromApi({ type: "lost", mode: "semantic", q: "검은 지갑", status: "", page: "2", limit: "1" }, controller.signal);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("/api/posts?type=lost&mode=semantic&q=%EA%B2%80%EC%9D%80+%EC%A7%80%EA%B0%91&status=&page=2&limit=1");
    expect(options).toMatchObject({ credentials: "same-origin", redirect: "error", signal: controller.signal });
    expect(options.headers).toBeUndefined();
    expect(result.items[0].createdAt).toBeInstanceOf(Date);
    expect(result.items[0]).toHaveProperty("lostAt", null);
    expect(result).toMatchObject({ page: 2, total: 3, totalPages: 3 });
  });

  it("reports an HTML protection/login response without attempting JSON parsing", async () => {
    const response = new Response("<!DOCTYPE html><title>Authentication Required</title>", { headers: { "content-type": "text/html" } });
    const parse = vi.spyOn(response, "json");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(fetchPostsFromApi({ type: "found", mode: "semantic" })).rejects.toThrow("non-JSON response");
    expect(parse).not.toHaveBeenCalled();
  });

  it("keeps actual API failures distinct from a protection HTML response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"unavailable"}', { status: 503, headers: { "content-type": "application/json" } })));
    await expect(fetchPostsFromApi({ type: "found", mode: "semantic" })).rejects.toThrow("status 503");
  });

  it("propagates cancellation instead of returning an empty result", async () => {
    const error = new DOMException("cancelled", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    await expect(fetchPostsFromApi({ type: "found" })).rejects.toBe(error);
  });
});
