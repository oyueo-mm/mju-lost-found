import { beforeEach, describe, expect, it, vi } from "vitest";

const dangerouslyDeleteBySrcImage = vi.fn();
vi.mock("@vercel/functions", () => ({ dangerouslyDeleteBySrcImage }));

// Storage stand-in for deletePostImagePaths()
const remove = vi.fn();
const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/post-images/${path}` } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ storage: { from: () => ({ remove, getPublicUrl }) } }) }));

const { hasImagePurgeApi, purgeOptimizedImages } = await import("./imageCache");
const { deletePostImagePaths } = await import("./supabaseAdmin");

// Vercel's request context, as a deployed function sees it (the purge API
// @vercel/functions calls into)
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");
const setRequestContext = (context: unknown) => {
  (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] = context === undefined ? undefined : { get: () => context };
};

const URL_A = "https://project.supabase.co/storage/v1/object/public/post-images/posts/lost/1/a.webp";

beforeEach(() => {
  dangerouslyDeleteBySrcImage.mockReset();
  dangerouslyDeleteBySrcImage.mockResolvedValue(undefined);
  setRequestContext({ purge: { dangerouslyDeleteBySrcImage: () => Promise.resolve() } });
  vi.spyOn(console, "info").mockImplementation(() => {});
  remove.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
});

describe("이미지 캐시 제거", () => {
  it("deletes the cached transformations of the source URLs in one call, only on Vercel", async () => {
    expect(await purgeOptimizedImages([URL_A, URL_A, ""], { VERCEL: "1" })).toBe("purged");
    expect(dangerouslyDeleteBySrcImage).toHaveBeenCalledWith([URL_A], { revalidationDeadlineSeconds: 0 });
    // local runs, scripts and tests: nothing to purge
    expect(await purgeOptimizedImages([URL_A], {})).toBe("skipped");
    expect(await purgeOptimizedImages([], { VERCEL: "1" })).toBe("skipped");
    expect(dangerouslyDeleteBySrcImage).toHaveBeenCalledTimes(1);
  });

  it("never reports a purge the function cannot make: no purge API in the request context", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const context of [undefined, {}, { purge: {} }]) {
      setRequestContext(context);
      expect(hasImagePurgeApi()).toBe(false);
      expect(await purgeOptimizedImages([URL_A], { VERCEL: "1" })).toBe("unavailable");
    }
    expect(dangerouslyDeleteBySrcImage).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(3);
    expect(String(error.mock.calls[0][0])).toContain("unavailable");
    expect(String(error.mock.calls[0][0])).toContain(URL_A);
    error.mockRestore();
  });

  it("logs a purge the API accepted as requested, without the URL", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await purgeOptimizedImages([URL_A], { VERCEL: "1" })).toBe("purged");
    expect(String(info.mock.calls.at(-1)?.[0])).toBe("Image cache purge requested for 1 image(s)");
  });

  it("retries a transient failure", async () => {
    dangerouslyDeleteBySrcImage.mockRejectedValueOnce(Object.assign(new Error("Too Many Requests"), { status: 429 }));
    expect(await purgeOptimizedImages([URL_A], { VERCEL: "1" }, { baseDelayMs: 0 })).toBe("purged");
    expect(dangerouslyDeleteBySrcImage).toHaveBeenCalledTimes(2);
  });

  it("never throws: a failure that outlasts the retries is logged with the URLs to purge by hand", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    dangerouslyDeleteBySrcImage.mockRejectedValue(Object.assign(new Error("Too Many Requests"), { status: 429 }));
    expect(await purgeOptimizedImages([URL_A], { VERCEL: "1" }, { baseDelayMs: 0 })).toBe("failed");
    expect(dangerouslyDeleteBySrcImage).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("status 429");
    expect(String(error.mock.calls[0][0])).toContain(URL_A);
    error.mockRestore();
  });

  it("is part of every photo deletion -- also when Storage could not remove the file", async () => {
    process.env.VERCEL = "1";
    try {
      remove.mockResolvedValueOnce({ error: null });
      expect(await deletePostImagePaths(["posts/lost/1/a.webp"])).toBe(true);
      expect(dangerouslyDeleteBySrcImage).toHaveBeenLastCalledWith([URL_A], { revalidationDeadlineSeconds: 0 });

      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      remove.mockResolvedValue({ error: new Error("down") });
      expect(await deletePostImagePaths(["posts/lost/1/a.webp"], { attempts: 1, baseDelayMs: 0 })).toBe(false);
      expect(dangerouslyDeleteBySrcImage).toHaveBeenCalledTimes(2);
      // a purge failure does not change the deletion's own result
      remove.mockResolvedValueOnce({ error: null });
      dangerouslyDeleteBySrcImage.mockRejectedValue(new Error("x"));
      expect(await deletePostImagePaths(["posts/lost/1/a.webp"])).toBe(true);
      error.mockRestore();
    } finally {
      delete process.env.VERCEL;
    }
  });
});
