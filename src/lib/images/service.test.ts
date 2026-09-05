import { beforeEach, describe, expect, it, vi } from "vitest";

const lostPost = { findUnique: vi.fn(), update: vi.fn() };
const foundPost = { findUnique: vi.fn(), update: vi.fn() };
const deleteObjectSafely = vi.fn();
const publicUrlFor = vi.fn();

vi.mock("@/lib/db/prisma", () => ({ prisma: { lostPost, foundPost } }));
vi.mock("./supabaseAdmin", () => ({ deleteObjectSafely, publicUrlFor }));

const { clearPostImage, setPostImage } = await import("./service");

const VALID_PATH = "posts/lost/1/11111111-1111-1111-1111-111111111111.jpg";

beforeEach(() => {
  vi.clearAllMocks();
  publicUrlFor.mockImplementation((path: string) => `https://storage.example/post-images/${path}`);
});

describe("setPostImage", () => {
  it("returns not_found for a nonexistent post", async () => {
    lostPost.findUnique.mockResolvedValueOnce(null);
    const result = await setPostImage("lost", 1, 1, { path: VALID_PATH });
    expect(result).toEqual({ kind: "not_found" });
  });

  it("rejects attaching an image to someone else's post", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
    const result = await setPostImage("lost", 1, 2, { path: VALID_PATH });
    expect(result).toEqual({ kind: "forbidden" });
    expect(lostPost.update).not.toHaveBeenCalled();
  });

  it("rejects a path that doesn't parse as a valid posts/{type}/{id}/{uuid}.{ext} shape", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });

    const result = await setPostImage("lost", 1, 1, { path: "not-a-valid-path.jpg" });

    expect(result).toEqual({ kind: "invalid_path" });
    expect(lostPost.update).not.toHaveBeenCalled();
  });

  it("rejects a path that names a different post than the one being updated (postId mismatch)", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });

    // Well-formed, but for post id 2 -- attaching it to post 1 must fail
    // even though the requester owns post 1.
    const result = await setPostImage("lost", 1, 1, {
      path: "posts/lost/2/11111111-1111-1111-1111-111111111111.jpg",
    });

    expect(result).toEqual({ kind: "invalid_path" });
    expect(lostPost.update).not.toHaveBeenCalled();
  });

  it("rejects a path that names the right id but the wrong board (found vs lost)", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });

    const result = await setPostImage("lost", 1, 1, {
      path: "posts/found/1/11111111-1111-1111-1111-111111111111.jpg",
    });

    expect(result).toEqual({ kind: "invalid_path" });
  });

  it("saves the new image (derived server-side from the path) and only then deletes the old one", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://old/image.jpg" });
    lostPost.update.mockResolvedValueOnce({ imageUrl: "https://storage.example/post-images/" + VALID_PATH });

    const result = await setPostImage("lost", 1, 1, { path: VALID_PATH });

    const newUrl = "https://storage.example/post-images/" + VALID_PATH;
    expect(result).toEqual({ kind: "ok", data: { imageUrl: newUrl } });
    expect(lostPost.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { imageUrl: newUrl } });
    expect(deleteObjectSafely).toHaveBeenCalledWith("https://old/image.jpg");

    const updateOrder = lostPost.update.mock.invocationCallOrder[0];
    const deleteOrder = deleteObjectSafely.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(deleteOrder);
  });

  it("doesn't attempt to delete anything when there was no previous image", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
    lostPost.update.mockResolvedValueOnce({ imageUrl: "https://storage.example/post-images/" + VALID_PATH });

    await setPostImage("lost", 1, 1, { path: VALID_PATH });

    expect(deleteObjectSafely).not.toHaveBeenCalled();
  });
});

describe("clearPostImage", () => {
  it("rejects clearing someone else's post image", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x/y.jpg" });
    const result = await clearPostImage("found", 1, 2);
    expect(result).toEqual({ kind: "forbidden" });
    expect(foundPost.update).not.toHaveBeenCalled();
  });

  it("nulls the imageUrl and deletes the storage object", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x/y.jpg" });
    foundPost.update.mockResolvedValueOnce({ imageUrl: null });

    const result = await clearPostImage("found", 1, 1);

    expect(result).toEqual({ kind: "ok", data: { imageUrl: null } });
    expect(foundPost.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { imageUrl: null } });
    expect(deleteObjectSafely).toHaveBeenCalledWith("https://x/y.jpg");
  });

  it("is a no-op delete-wise when there was no image to begin with", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
    foundPost.update.mockResolvedValueOnce({ imageUrl: null });

    await clearPostImage("found", 1, 1);

    expect(deleteObjectSafely).not.toHaveBeenCalled();
  });
});
