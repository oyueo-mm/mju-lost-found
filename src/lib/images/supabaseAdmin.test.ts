import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSignedUploadUrl = vi.fn();
const getPublicUrl = vi.fn();
const remove = vi.fn();
const from = vi.fn(() => ({ createSignedUploadUrl, getPublicUrl, remove }));
const createClient = vi.fn(() => ({ storage: { from } }));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { createSignedUploadUrl: mintUrl, publicUrlFor, pathnameFromPublicUrl, deleteObjectSafely, deletePostImagePaths, DELETE_ATTEMPTS } =
  await import("./supabaseAdmin");

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
  getPublicUrl.mockImplementation((path: string) => ({
    data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/post-images/${path}` },
  }));
});

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
});

describe("createSignedUploadUrl", () => {
  it("returns the path/token from a successful mint", async () => {
    createSignedUploadUrl.mockResolvedValueOnce({
      data: { path: "posts/lost/1/x.jpg", token: "tok", signedUrl: "https://ignored" },
      error: null,
    });

    const result = await mintUrl("posts/lost/1/x.jpg");

    expect(result).toEqual({ path: "posts/lost/1/x.jpg", token: "tok" });
    expect(from).toHaveBeenCalledWith("post-images");
  });

  it("throws a descriptive error when Supabase reports a failure", async () => {
    createSignedUploadUrl.mockResolvedValueOnce({ data: null, error: { message: "bucket not found" } });

    await expect(mintUrl("posts/lost/1/x.jpg")).rejects.toThrow(/bucket not found/);
  });
});

describe("publicUrlFor / pathnameFromPublicUrl", () => {
  it("round-trips a path through publicUrlFor and back", () => {
    const url = publicUrlFor("posts/lost/1/x.jpg");
    expect(url).toBe("https://project.supabase.co/storage/v1/object/public/post-images/posts/lost/1/x.jpg");
    expect(pathnameFromPublicUrl(url)).toBe("posts/lost/1/x.jpg");
  });

  it("returns null for a URL that isn't one of ours", () => {
    expect(pathnameFromPublicUrl("https://attacker.example/fake.jpg")).toBeNull();
  });
});

describe("deleteObjectSafely", () => {
  it("removes the object at the path recovered from the public URL", async () => {
    remove.mockResolvedValueOnce({ data: [], error: null });

    await deleteObjectSafely(
      "https://project.supabase.co/storage/v1/object/public/post-images/posts/lost/1/x.jpg",
    );

    expect(remove).toHaveBeenCalledWith(["posts/lost/1/x.jpg"]);
  });

  it("swallows a remove() failure instead of throwing, after retrying", async () => {
    remove.mockResolvedValue({ data: null, error: { message: "network error" } });

    await expect(
      deleteObjectSafely("https://project.supabase.co/storage/v1/object/public/post-images/x.jpg", { baseDelayMs: 0 }),
    ).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledTimes(DELETE_ATTEMPTS);
  });

  // 개인정보 감사: post-images is public, so a transient failure must not
  // leave the file reachable.
  it("retries a transient failure and stops once the remove succeeds", async () => {
    remove
      .mockResolvedValueOnce({ data: null, error: { message: "503" } })
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce({ data: [], error: null });

    await deleteObjectSafely("https://project.supabase.co/storage/v1/object/public/post-images/posts/lost/1/x.jpg", {
      baseDelayMs: 0,
    });

    expect(remove).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenLastCalledWith(["posts/lost/1/x.jpg"]);
  });

  it("does nothing (and doesn't throw) for a URL that isn't recognized as ours", async () => {
    await expect(deleteObjectSafely("https://attacker.example/fake.jpg")).resolves.toBeUndefined();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("deletePostImagePaths", () => {
  it("reports success or final failure, and skips an empty list", async () => {
    remove.mockResolvedValueOnce({ data: [], error: null });
    expect(await deletePostImagePaths(["a.jpg", "b.jpg"], { baseDelayMs: 0 })).toBe(true);
    expect(remove).toHaveBeenCalledWith(["a.jpg", "b.jpg"]);

    remove.mockReset();
    remove.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await deletePostImagePaths(["a.jpg"], { attempts: 2, baseDelayMs: 0 })).toBe(false);
    expect(remove).toHaveBeenCalledTimes(2);

    remove.mockReset();
    expect(await deletePostImagePaths([])).toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });
});
