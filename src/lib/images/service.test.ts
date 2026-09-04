import { beforeEach, describe, expect, it, vi } from "vitest";

const lostPost = { findUnique: vi.fn(), update: vi.fn() };
const foundPost = { findUnique: vi.fn(), update: vi.fn() };
const isOurBlobUrl = vi.fn();
const deleteBlobSafely = vi.fn();

vi.mock("@/lib/db/prisma", () => ({ prisma: { lostPost, foundPost } }));
vi.mock("./blob", () => ({ isOurBlobUrl, deleteBlobSafely }));

const { clearPostImage, setPostImage } = await import("./service");

beforeEach(() => {
  vi.clearAllMocks();
  isOurBlobUrl.mockReturnValue(true);
});

describe("setPostImage", () => {
  it("returns not_found for a nonexistent post", async () => {
    lostPost.findUnique.mockResolvedValueOnce(null);
    const result = await setPostImage("lost", 1, 1, { url: "u", pathname: "p" });
    expect(result).toEqual({ kind: "not_found" });
  });

  it("rejects attaching an image to someone else's post", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
    const result = await setPostImage("lost", 1, 2, { url: "u", pathname: "p" });
    expect(result).toEqual({ kind: "forbidden" });
    expect(lostPost.update).not.toHaveBeenCalled();
  });

  it("rejects a URL that isn't genuinely from our Blob store", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
    isOurBlobUrl.mockReturnValueOnce(false);

    const result = await setPostImage("lost", 1, 1, {
      url: "https://attacker.example/fake.jpg",
      pathname: "posts/lost/1/x.jpg",
    });

    expect(result).toEqual({ kind: "invalid_url" });
    expect(lostPost.update).not.toHaveBeenCalled();
  });

  it("saves the new image and only then deletes the old blob (never the other order)", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://old/blob.jpg" });
    lostPost.update.mockResolvedValueOnce({ imageUrl: "https://new/blob.jpg" });

    const result = await setPostImage("lost", 1, 1, {
      url: "https://new/blob.jpg",
      pathname: "posts/lost/1/new.jpg",
    });

    expect(result).toEqual({ kind: "ok", data: { imageUrl: "https://new/blob.jpg" } });
    expect(lostPost.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { imageUrl: "https://new/blob.jpg" } });
    expect(deleteBlobSafely).toHaveBeenCalledWith("https://old/blob.jpg");

    const updateOrder = lostPost.update.mock.invocationCallOrder[0];
    const deleteOrder = deleteBlobSafely.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(deleteOrder);
  });

  it("doesn't attempt to delete anything when there was no previous image", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
    lostPost.update.mockResolvedValueOnce({ imageUrl: "https://new/blob.jpg" });

    await setPostImage("lost", 1, 1, { url: "https://new/blob.jpg", pathname: "posts/lost/1/new.jpg" });

    expect(deleteBlobSafely).not.toHaveBeenCalled();
  });
});

describe("clearPostImage", () => {
  it("rejects clearing someone else's post image", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x/y.jpg" });
    const result = await clearPostImage("found", 1, 2);
    expect(result).toEqual({ kind: "forbidden" });
    expect(foundPost.update).not.toHaveBeenCalled();
  });

  it("nulls the imageUrl and deletes the blob", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x/y.jpg" });
    foundPost.update.mockResolvedValueOnce({ imageUrl: null });

    const result = await clearPostImage("found", 1, 1);

    expect(result).toEqual({ kind: "ok", data: { imageUrl: null } });
    expect(foundPost.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { imageUrl: null } });
    expect(deleteBlobSafely).toHaveBeenCalledWith("https://x/y.jpg");
  });

  it("is a no-op delete-wise when there was no image to begin with", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
    foundPost.update.mockResolvedValueOnce({ imageUrl: null });

    await clearPostImage("found", 1, 1);

    expect(deleteBlobSafely).not.toHaveBeenCalled();
  });
});
