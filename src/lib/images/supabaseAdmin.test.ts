import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSignedUploadUrl = vi.fn();
const getPublicUrl = vi.fn();
const remove = vi.fn();
const from = vi.fn(() => ({ createSignedUploadUrl, getPublicUrl, remove }));
const createClient = vi.fn(() => ({ storage: { from } }));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { createSignedUploadUrl: mintUrl, publicUrlFor, pathnameFromPublicUrl, deleteObjectSafely } =
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

  it("swallows a remove() failure instead of throwing", async () => {
    remove.mockResolvedValueOnce({ data: null, error: { message: "network error" } });

    await expect(
      deleteObjectSafely("https://project.supabase.co/storage/v1/object/public/post-images/x.jpg"),
    ).resolves.toBeUndefined();
  });

  it("does nothing (and doesn't throw) for a URL that isn't recognized as ours", async () => {
    await expect(deleteObjectSafely("https://attacker.example/fake.jpg")).resolves.toBeUndefined();
    expect(remove).not.toHaveBeenCalled();
  });
});
