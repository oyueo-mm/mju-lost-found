import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const del = vi.fn();
vi.mock("@vercel/blob", () => ({ del }));

const { deleteBlobSafely, isOurBlobUrl } = await import("./blob");

const ORIGINAL_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

afterEach(() => {
  process.env.BLOB_READ_WRITE_TOKEN = ORIGINAL_TOKEN;
  vi.clearAllMocks();
});

describe("isOurBlobUrl", () => {
  it("fails closed when no token is configured -- never trusts any URL", () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(isOurBlobUrl("https://abc123.public.blob.vercel-storage.com/posts/lost/1/x.jpg", "posts/lost/1/x.jpg")).toBe(
      false,
    );
  });

  describe("with a configured token", () => {
    beforeEach(() => {
      process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_abc123_secretpart";
    });

    it("accepts a URL matching our store's host and the expected pathname", () => {
      expect(
        isOurBlobUrl(
          "https://abc123.public.blob.vercel-storage.com/posts/lost/1/x.jpg",
          "posts/lost/1/x.jpg",
        ),
      ).toBe(true);
    });

    it("rejects an arbitrary external URL (attacker-supplied)", () => {
      expect(
        isOurBlobUrl("https://attacker.example/fake.jpg", "posts/lost/1/x.jpg"),
      ).toBe(false);
    });

    it("rejects a URL on a different Blob store", () => {
      expect(
        isOurBlobUrl(
          "https://someone-elses-store.public.blob.vercel-storage.com/posts/lost/1/x.jpg",
          "posts/lost/1/x.jpg",
        ),
      ).toBe(false);
    });

    it("rejects a URL whose pathname doesn't match the one that was uploaded", () => {
      expect(
        isOurBlobUrl(
          "https://abc123.public.blob.vercel-storage.com/posts/lost/1/other.jpg",
          "posts/lost/1/x.jpg",
        ),
      ).toBe(false);
    });

    it("rejects a malformed URL", () => {
      expect(isOurBlobUrl("not a url", "posts/lost/1/x.jpg")).toBe(false);
    });
  });
});

describe("deleteBlobSafely", () => {
  it("calls the Blob SDK's del()", async () => {
    del.mockResolvedValueOnce(undefined);
    await deleteBlobSafely("https://abc123.public.blob.vercel-storage.com/posts/lost/1/x.jpg");
    expect(del).toHaveBeenCalledWith("https://abc123.public.blob.vercel-storage.com/posts/lost/1/x.jpg");
  });

  it("swallows a delete failure instead of throwing", async () => {
    del.mockRejectedValueOnce(new Error("network error"));
    await expect(deleteBlobSafely("https://abc123.public.blob.vercel-storage.com/x.jpg")).resolves.toBeUndefined();
  });
});
