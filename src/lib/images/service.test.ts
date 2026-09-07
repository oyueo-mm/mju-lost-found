import { beforeEach, describe, expect, it, vi } from "vitest";

const lostPost = { findUnique: vi.fn(), update: vi.fn() };
const foundPost = { findUnique: vi.fn(), update: vi.fn() };
const deleteObjectSafely = vi.fn();
const publicUrlFor = vi.fn();
const saveImageEmbedding = vi.fn();

vi.mock("@/lib/db/prisma", () => ({ prisma: { lostPost, foundPost } }));
vi.mock("./supabaseAdmin", () => ({ deleteObjectSafely, publicUrlFor }));
// Phase 15-2: saveImageEmbedding is a pure SQL column write (no model
// involved), so it's still called directly from here (clearPostImage) --
// but embedPostImageBestEffort is deliberately NOT called from this
// module anymore (see setPostImage's own comment: it's triggered via an
// internal request to PUT /api/posts/[id] instead, for Vercel
// function-bundle-size reasons), so it isn't mocked here at all.
vi.mock("@/lib/ai/vectorSearch", () => ({ saveImageEmbedding }));

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

  // Phase G-4: orphan cleanup for a previous failed attach attempt.
  describe("previousAttemptPath cleanup", () => {
    const PREVIOUS_PATH = "posts/lost/1/22222222-2222-2222-2222-222222222222.jpg";

    it("deletes a previousAttemptPath that names the same (type, id) as this request", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
      lostPost.update.mockResolvedValueOnce({ imageUrl: "https://storage.example/post-images/" + VALID_PATH });

      await setPostImage("lost", 1, 1, { path: VALID_PATH, previousAttemptPath: PREVIOUS_PATH });

      expect(deleteObjectSafely).toHaveBeenCalledWith("https://storage.example/post-images/" + PREVIOUS_PATH);
    });

    it("never trusts a previousAttemptPath at face value -- ignores one naming a different post id", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
      lostPost.update.mockResolvedValueOnce({ imageUrl: "https://storage.example/post-images/" + VALID_PATH });

      await setPostImage("lost", 1, 1, {
        path: VALID_PATH,
        previousAttemptPath: "posts/lost/999/22222222-2222-2222-2222-222222222222.jpg",
      });

      expect(deleteObjectSafely).not.toHaveBeenCalled();
    });

    it("ignores a previousAttemptPath naming the right id but the wrong board", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
      lostPost.update.mockResolvedValueOnce({ imageUrl: "https://storage.example/post-images/" + VALID_PATH });

      await setPostImage("lost", 1, 1, {
        path: VALID_PATH,
        previousAttemptPath: "posts/found/1/22222222-2222-2222-2222-222222222222.jpg",
      });

      expect(deleteObjectSafely).not.toHaveBeenCalled();
    });

    it("ignores a malformed previousAttemptPath instead of failing the whole attach", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
      lostPost.update.mockResolvedValueOnce({ imageUrl: "https://storage.example/post-images/" + VALID_PATH });

      const result = await setPostImage("lost", 1, 1, {
        path: VALID_PATH,
        previousAttemptPath: "not-a-real-path",
      });

      expect(result.kind).toBe("ok");
      expect(deleteObjectSafely).not.toHaveBeenCalled();
    });

    it("does not re-delete the same path it just attached (previousAttemptPath === path)", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
      lostPost.update.mockResolvedValueOnce({ imageUrl: "https://storage.example/post-images/" + VALID_PATH });

      await setPostImage("lost", 1, 1, { path: VALID_PATH, previousAttemptPath: VALID_PATH });

      expect(deleteObjectSafely).not.toHaveBeenCalled();
    });

    it("cleans up both the previous *attached* image and a previousAttemptPath orphan in the same call", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://old/image.jpg" });
      lostPost.update.mockResolvedValueOnce({ imageUrl: "https://storage.example/post-images/" + VALID_PATH });

      await setPostImage("lost", 1, 1, { path: VALID_PATH, previousAttemptPath: PREVIOUS_PATH });

      expect(deleteObjectSafely).toHaveBeenCalledWith("https://old/image.jpg");
      expect(deleteObjectSafely).toHaveBeenCalledWith("https://storage.example/post-images/" + PREVIOUS_PATH);
      expect(deleteObjectSafely).toHaveBeenCalledTimes(2);
    });
  });
});

describe("clearPostImage", () => {
  it("rejects clearing someone else's post image", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x/y.jpg" });
    const result = await clearPostImage("found", 1, 2);
    expect(result).toEqual({ kind: "forbidden" });
    expect(foundPost.update).not.toHaveBeenCalled();
    expect(saveImageEmbedding).not.toHaveBeenCalled();
  });

  it("nulls the imageUrl, clears the image embedding, and deletes the storage object", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x/y.jpg" });
    foundPost.update.mockResolvedValueOnce({ imageUrl: null });

    const result = await clearPostImage("found", 1, 1);

    expect(result).toEqual({ kind: "ok", data: { imageUrl: null } });
    expect(foundPost.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { imageUrl: null } });
    expect(saveImageEmbedding).toHaveBeenCalledWith("found", 1, null);
    expect(deleteObjectSafely).toHaveBeenCalledWith("https://x/y.jpg");
  });

  it("is a no-op delete-wise when there was no image to begin with", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
    foundPost.update.mockResolvedValueOnce({ imageUrl: null });

    await clearPostImage("found", 1, 1);

    expect(deleteObjectSafely).not.toHaveBeenCalled();
  });

  // Phase G-4: a transient failure clearing the (separate) imageEmbedding
  // column must never turn an already-committed imageUrl removal into a
  // reported failure -- the imageUrl write above already succeeded and
  // there's no transaction to roll it back with either way.
  it("still succeeds (imageUrl already cleared) even when saveImageEmbedding throws", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x/y.jpg" });
    foundPost.update.mockResolvedValueOnce({ imageUrl: null });
    saveImageEmbedding.mockRejectedValueOnce(new Error("transient DB error"));

    const result = await clearPostImage("found", 1, 1);

    expect(result).toEqual({ kind: "ok", data: { imageUrl: null } });
    expect(foundPost.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { imageUrl: null } });
    // Storage cleanup still runs even though the embedding write failed --
    // the two are independent best-effort side effects, not one guarding
    // the other.
    expect(deleteObjectSafely).toHaveBeenCalledWith("https://x/y.jpg");
  });
});
