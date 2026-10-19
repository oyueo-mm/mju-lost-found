import { beforeEach, describe, expect, it, vi } from "vitest";

const dangerouslyDeleteBySrcImage = vi.fn();
vi.mock("@vercel/functions", () => ({ dangerouslyDeleteBySrcImage }));

// Storage stand-in for deletePostImagePaths()
const remove = vi.fn();
const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/post-images/${path}` } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ storage: { from: () => ({ remove, getPublicUrl }) } }) }));

const { purgeOptimizedImages } = await import("./imageCache");
const { deletePostImagePaths } = await import("./supabaseAdmin");

const URL_A = "https://project.supabase.co/storage/v1/object/public/post-images/posts/lost/1/a.webp";

beforeEach(() => {
  dangerouslyDeleteBySrcImage.mockReset();
  dangerouslyDeleteBySrcImage.mockResolvedValue(undefined);
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

  it("never throws: a failure is logged without the URL", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    dangerouslyDeleteBySrcImage.mockRejectedValueOnce(Object.assign(new Error("Too Many Requests"), { status: 429 }));
    expect(await purgeOptimizedImages([URL_A], { VERCEL: "1" })).toBe("failed");
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("status 429");
    expect(String(error.mock.calls[0][0])).not.toContain("post-images");
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
      dangerouslyDeleteBySrcImage.mockRejectedValueOnce(new Error("x"));
      expect(await deletePostImagePaths(["posts/lost/1/a.webp"])).toBe(true);
      error.mockRestore();
    } finally {
      delete process.env.VERCEL;
    }
  });
});
