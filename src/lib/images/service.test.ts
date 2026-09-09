import { beforeEach, describe, expect, it, vi } from "vitest";

const lostPost = { findUnique: vi.fn(), update: vi.fn() };
const foundPost = { findUnique: vi.fn(), update: vi.fn() };
// Phase 11-4C: setPostImage/attachPostImages/deletePostImage/clearPostImage
// all now do their writes inside prisma.$transaction -- see comment/
// service.test.ts's own $transaction mock (same shape): the mock just
// invokes the callback with the same top-level lostPost/foundPost/postImage
// mocks as `tx`, so every existing assertion against e.g. `lostPost.update`
// still works unchanged whether or not the real call happened inside a
// transaction.
const postImage = {
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  deleteMany: vi.fn(),
  count: vi.fn(),
};
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ lostPost, foundPost, postImage }));
const deleteObjectSafely = vi.fn();
const publicUrlFor = vi.fn();
const saveImageEmbedding = vi.fn();

vi.mock("@/lib/db/prisma", () => ({ prisma: { lostPost, foundPost, postImage, $transaction } }));
vi.mock("./supabaseAdmin", () => ({ deleteObjectSafely, publicUrlFor }));
// Phase 15-2: saveImageEmbedding is a pure SQL column write (no model
// involved), so it's still called directly from here (clearPostImage) --
// but embedPostImageBestEffort is deliberately NOT called from this
// module anymore (see setPostImage's own comment: it's triggered via an
// internal request to PUT /api/posts/[id] instead, for Vercel
// function-bundle-size reasons), so it isn't mocked here at all.
vi.mock("@/lib/ai/vectorSearch", () => ({ saveImageEmbedding }));

const { attachPostImages, clearPostImage, deletePostImage, reorderPostImages, setPostImage } =
  await import("./service");

const VALID_PATH = "posts/lost/1/11111111-1111-1111-1111-111111111111.jpg";
const VALID_PATH_2 = "posts/lost/1/22222222-2222-2222-2222-222222222222.jpg";
const VALID_PATH_3 = "posts/lost/1/33333333-3333-3333-3333-333333333333.jpg";

beforeEach(() => {
  vi.clearAllMocks();
  publicUrlFor.mockImplementation((path: string) => `https://storage.example/post-images/${path}`);
  postImage.findFirst.mockResolvedValue(null);
  postImage.findMany.mockResolvedValue([]);
  postImage.count.mockResolvedValue(0);
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

    await setPostImage("lost", 1, 1, { path: VALID_PATH });

    expect(deleteObjectSafely).not.toHaveBeenCalled();
  });

  // Phase 11-4C: this legacy single-image call keeps the new PostImage
  // table in sync with whatever it just wrote to imageUrl.
  describe("PostImage sync", () => {
    it("creates a primary PostImage row when the post had no image before", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
      postImage.findFirst.mockResolvedValueOnce(null); // no existing primary row

      const newUrl = "https://storage.example/post-images/" + VALID_PATH;
      await setPostImage("lost", 1, 1, { path: VALID_PATH });

      expect(postImage.create).toHaveBeenCalledWith({
        data: { lostPostId: 1, imageUrl: newUrl, displayOrder: 0, isPrimary: true },
      });
      expect(postImage.update).not.toHaveBeenCalled();
    });

    it("replaces the existing primary PostImage row in place instead of creating a second one", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://old/image.jpg" });
      postImage.findFirst.mockResolvedValueOnce({ id: 42, isPrimary: true });

      const newUrl = "https://storage.example/post-images/" + VALID_PATH;
      await setPostImage("lost", 1, 1, { path: VALID_PATH });

      expect(postImage.update).toHaveBeenCalledWith({ where: { id: 42 }, data: { imageUrl: newUrl } });
      expect(postImage.create).not.toHaveBeenCalled();
    });
  });

  // Phase G-4: orphan cleanup for a previous failed attach attempt.
  describe("previousAttemptPath cleanup", () => {
    const PREVIOUS_PATH = "posts/lost/1/22222222-2222-2222-2222-222222222222.jpg";

    it("deletes a previousAttemptPath that names the same (type, id) as this request", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });

      await setPostImage("lost", 1, 1, { path: VALID_PATH, previousAttemptPath: PREVIOUS_PATH });

      expect(deleteObjectSafely).toHaveBeenCalledWith("https://storage.example/post-images/" + PREVIOUS_PATH);
    });

    it("never trusts a previousAttemptPath at face value -- ignores one naming a different post id", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });

      await setPostImage("lost", 1, 1, {
        path: VALID_PATH,
        previousAttemptPath: "posts/lost/999/22222222-2222-2222-2222-222222222222.jpg",
      });

      expect(deleteObjectSafely).not.toHaveBeenCalled();
    });

    it("ignores a previousAttemptPath naming the right id but the wrong board", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });

      await setPostImage("lost", 1, 1, {
        path: VALID_PATH,
        previousAttemptPath: "posts/found/1/22222222-2222-2222-2222-222222222222.jpg",
      });

      expect(deleteObjectSafely).not.toHaveBeenCalled();
    });

    it("ignores a malformed previousAttemptPath instead of failing the whole attach", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });

      const result = await setPostImage("lost", 1, 1, {
        path: VALID_PATH,
        previousAttemptPath: "not-a-real-path",
      });

      expect(result.kind).toBe("ok");
      expect(deleteObjectSafely).not.toHaveBeenCalled();
    });

    it("does not re-delete the same path it just attached (previousAttemptPath === path)", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });

      await setPostImage("lost", 1, 1, { path: VALID_PATH, previousAttemptPath: VALID_PATH });

      expect(deleteObjectSafely).not.toHaveBeenCalled();
    });

    it("cleans up both the previous *attached* image and a previousAttemptPath orphan in the same call", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://old/image.jpg" });

      await setPostImage("lost", 1, 1, { path: VALID_PATH, previousAttemptPath: PREVIOUS_PATH });

      expect(deleteObjectSafely).toHaveBeenCalledWith("https://old/image.jpg");
      expect(deleteObjectSafely).toHaveBeenCalledWith("https://storage.example/post-images/" + PREVIOUS_PATH);
      expect(deleteObjectSafely).toHaveBeenCalledTimes(2);
    });
  });
});

describe("attachPostImages", () => {
  it("returns not_found for a nonexistent post", async () => {
    lostPost.findUnique.mockResolvedValueOnce(null);
    const result = await attachPostImages("lost", 1, 1, { paths: [VALID_PATH] });
    expect(result).toEqual({ kind: "not_found" });
  });

  it("rejects attaching to someone else's post", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
    const result = await attachPostImages("lost", 1, 2, { paths: [VALID_PATH] });
    expect(result).toEqual({ kind: "forbidden" });
    expect(postImage.create).not.toHaveBeenCalled();
  });

  it("rejects a path naming a different post id (cross-post-path)", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });

    const result = await attachPostImages("lost", 1, 1, {
      paths: ["posts/lost/2/11111111-1111-1111-1111-111111111111.jpg"],
    });

    expect(result).toEqual({ kind: "invalid_path" });
    expect(postImage.create).not.toHaveBeenCalled();
  });

  it("rejects a path naming the right id but the wrong board (wrong-postType)", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });

    const result = await attachPostImages("lost", 1, 1, {
      paths: ["posts/found/1/11111111-1111-1111-1111-111111111111.jpg"],
    });

    expect(result).toEqual({ kind: "invalid_path" });
  });

  it("attaches a single image as the primary when the post has none yet", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
    postImage.count.mockResolvedValueOnce(0); // fresh in-tx recount
    postImage.findFirst.mockResolvedValueOnce(null); // no existing rows -- maxOrder
    postImage.count.mockResolvedValueOnce(0); // hasPrimary check
    postImage.create.mockResolvedValueOnce({ id: 10, imageUrl: "https://storage.example/post-images/" + VALID_PATH, displayOrder: 0, isPrimary: true });

    const result = await attachPostImages("lost", 1, 1, { paths: [VALID_PATH] });

    const newUrl = "https://storage.example/post-images/" + VALID_PATH;
    expect(postImage.create).toHaveBeenCalledWith({
      data: { lostPostId: 1, imageUrl: newUrl, displayOrder: 0, isPrimary: true },
    });
    expect(lostPost.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { imageUrl: newUrl } });
    expect(result).toEqual({
      kind: "ok",
      data: { images: [{ id: 10, imageUrl: newUrl, displayOrder: 0, isPrimary: true }], imageUrl: newUrl },
    });
  });

  it("attaches multiple images in one call, ordered after any existing images", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://storage.example/existing.jpg" });
    postImage.count.mockResolvedValueOnce(1); // fresh in-tx recount: 1 existing + 2 new = 3, allowed
    postImage.findFirst.mockResolvedValueOnce({ displayOrder: 0 }); // existing row at order 0
    postImage.count.mockResolvedValueOnce(1); // hasPrimary check: existing primary present
    postImage.create
      .mockResolvedValueOnce({ id: 11, imageUrl: "https://storage.example/post-images/" + VALID_PATH_2, displayOrder: 1, isPrimary: false })
      .mockResolvedValueOnce({ id: 12, imageUrl: "https://storage.example/post-images/" + VALID_PATH_3, displayOrder: 2, isPrimary: false });

    const result = await attachPostImages("lost", 1, 1, { paths: [VALID_PATH_2, VALID_PATH_3] });

    expect(postImage.create).toHaveBeenNthCalledWith(1, {
      data: { lostPostId: 1, imageUrl: "https://storage.example/post-images/" + VALID_PATH_2, displayOrder: 1, isPrimary: false },
    });
    expect(postImage.create).toHaveBeenNthCalledWith(2, {
      data: { lostPostId: 1, imageUrl: "https://storage.example/post-images/" + VALID_PATH_3, displayOrder: 2, isPrimary: false },
    });
    // An existing primary is never silently overwritten by a later attach.
    expect(lostPost.update).not.toHaveBeenCalled();
    expect(result.kind).toBe("ok");
  });

  it("allows attaching exactly up to MAX_IMAGES_PER_POST (5) images total", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
    postImage.count.mockResolvedValueOnce(2); // 2 existing + 3 new = 5, exactly at the cap
    postImage.findFirst.mockResolvedValueOnce({ displayOrder: 1 });
    postImage.count.mockResolvedValueOnce(1); // has a primary already
    postImage.create.mockResolvedValue({ id: 99, imageUrl: "https://x", displayOrder: 0, isPrimary: false });

    const result = await attachPostImages("lost", 1, 1, { paths: [VALID_PATH, VALID_PATH_2, VALID_PATH_3] });

    expect(result.kind).toBe("ok");
    expect(postImage.create).toHaveBeenCalledTimes(3);
  });

  it("rejects a 6th image that would push the post over MAX_IMAGES_PER_POST", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x" });
    postImage.count.mockResolvedValueOnce(5); // already at the cap

    const result = await attachPostImages("lost", 1, 1, { paths: [VALID_PATH] });

    expect(result).toEqual({ kind: "too_many_images" });
    expect(postImage.create).not.toHaveBeenCalled();
    // The upload already happened before this call (see the route layer) --
    // a too_many_images rejection must still best-effort clean up the
    // Storage object nothing will ever reference now.
    expect(deleteObjectSafely).toHaveBeenCalledWith("https://storage.example/post-images/" + VALID_PATH);
  });

  // Phase 11-4C's own failure-handling requirements.
  describe("failure handling", () => {
    it("best-effort cleans up every newly-uploaded Storage object when the DB attach fails", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
      postImage.count.mockResolvedValueOnce(0);
      postImage.findFirst.mockResolvedValueOnce(null);
      postImage.count.mockResolvedValueOnce(0);
      postImage.create.mockRejectedValueOnce(new Error("transient DB error"));

      await expect(attachPostImages("lost", 1, 1, { paths: [VALID_PATH, VALID_PATH_2] })).rejects.toThrow(
        "transient DB error",
      );

      expect(deleteObjectSafely).toHaveBeenCalledWith("https://storage.example/post-images/" + VALID_PATH);
      expect(deleteObjectSafely).toHaveBeenCalledWith("https://storage.example/post-images/" + VALID_PATH_2);
    });

    it("still surfaces the original error even if a cleanup delete itself fails", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
      postImage.count.mockResolvedValueOnce(0);
      postImage.findFirst.mockResolvedValueOnce(null);
      postImage.count.mockResolvedValueOnce(0);
      postImage.create.mockRejectedValueOnce(new Error("original DB error"));
      // deleteObjectSafely is documented to never throw in real code (see
      // supabaseAdmin.ts), but this proves the calling code doesn't rely on
      // that -- even a mock that does throw must not replace/hide the
      // original error.
      deleteObjectSafely.mockRejectedValueOnce(new Error("storage cleanup also failed"));

      await expect(attachPostImages("lost", 1, 1, { paths: [VALID_PATH] })).rejects.toThrow("original DB error");
    });
  });
});

describe("deletePostImage", () => {
  it("returns not_found for a nonexistent post", async () => {
    lostPost.findUnique.mockResolvedValueOnce(null);
    const result = await deletePostImage("lost", 1, 1, 10);
    expect(result).toEqual({ kind: "not_found" });
  });

  it("rejects deleting someone else's post's image", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x" });
    const result = await deletePostImage("lost", 1, 2, 10);
    expect(result).toEqual({ kind: "forbidden" });
    expect(postImage.delete).not.toHaveBeenCalled();
  });

  it("returns not_found for an imageId that belongs to a different post (cross-post-rejection)", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x" });
    postImage.findUnique.mockResolvedValueOnce({ id: 10, lostPostId: 2, foundPostId: null, imageUrl: "https://x", isPrimary: true });

    const result = await deletePostImage("lost", 1, 1, 10);

    expect(result).toEqual({ kind: "not_found" });
    expect(postImage.delete).not.toHaveBeenCalled();
  });

  it("returns not_found for a nonexistent imageId", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x" });
    postImage.findUnique.mockResolvedValueOnce(null);

    const result = await deletePostImage("lost", 1, 1, 999);

    expect(result).toEqual({ kind: "not_found" });
  });

  it("deletes a non-primary image without touching the primary/cache at all", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://cover.jpg" });
    postImage.findUnique.mockResolvedValueOnce({
      id: 20,
      lostPostId: 1,
      foundPostId: null,
      imageUrl: "https://second.jpg",
      isPrimary: false,
    });

    const result = await deletePostImage("lost", 1, 1, 20);

    expect(postImage.delete).toHaveBeenCalledWith({ where: { id: 20 } });
    expect(lostPost.update).not.toHaveBeenCalled();
    expect(deleteObjectSafely).toHaveBeenCalledWith("https://second.jpg");
    expect(result).toEqual({ kind: "ok", data: { imageUrl: "https://cover.jpg" } });
  });

  it("promotes the next-lowest-displayOrder image to primary when the primary is deleted", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://cover.jpg" });
    postImage.findUnique.mockResolvedValueOnce({
      id: 10,
      lostPostId: 1,
      foundPostId: null,
      imageUrl: "https://cover.jpg",
      isPrimary: true,
    });
    postImage.findFirst.mockResolvedValueOnce({ id: 11, imageUrl: "https://second.jpg", displayOrder: 1 });

    const result = await deletePostImage("lost", 1, 1, 10);

    expect(postImage.delete).toHaveBeenCalledWith({ where: { id: 10 } });
    expect(postImage.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { isPrimary: true } });
    expect(lostPost.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { imageUrl: "https://second.jpg" } });
    expect(deleteObjectSafely).toHaveBeenCalledWith("https://cover.jpg");
    // A promotion still has an image -- the embedding column must not be
    // cleared here (it needs recomputing for the *new* primary instead,
    // which the route layer triggers separately).
    expect(saveImageEmbedding).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "ok", data: { imageUrl: "https://second.jpg" } });
  });

  it("sets imageUrl to null and clears the embedding when the last remaining image is deleted", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://cover.jpg" });
    postImage.findUnique.mockResolvedValueOnce({
      id: 10,
      lostPostId: 1,
      foundPostId: null,
      imageUrl: "https://cover.jpg",
      isPrimary: true,
    });
    postImage.findFirst.mockResolvedValueOnce(null); // nothing left to promote

    const result = await deletePostImage("lost", 1, 1, 10);

    expect(lostPost.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { imageUrl: null } });
    expect(saveImageEmbedding).toHaveBeenCalledWith("lost", 1, null);
    expect(result).toEqual({ kind: "ok", data: { imageUrl: null } });
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

    const result = await clearPostImage("found", 1, 1);

    expect(result).toEqual({ kind: "ok", data: { imageUrl: null } });
    expect(foundPost.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { imageUrl: null } });
    expect(saveImageEmbedding).toHaveBeenCalledWith("found", 1, null);
    expect(deleteObjectSafely).toHaveBeenCalledWith("https://x/y.jpg");
  });

  it("is a no-op delete-wise when there was no image to begin with", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });

    await clearPostImage("found", 1, 1);

    expect(deleteObjectSafely).not.toHaveBeenCalled();
  });

  // Phase G-4: a transient failure clearing the (separate) imageEmbedding
  // column must never turn an already-committed imageUrl removal into a
  // reported failure -- the imageUrl write above already succeeded and
  // there's no transaction to roll it back with either way.
  it("still succeeds (imageUrl already cleared) even when saveImageEmbedding throws", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x/y.jpg" });
    saveImageEmbedding.mockRejectedValueOnce(new Error("transient DB error"));

    const result = await clearPostImage("found", 1, 1);

    expect(result).toEqual({ kind: "ok", data: { imageUrl: null } });
    expect(foundPost.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { imageUrl: null } });
    // Storage cleanup still runs even though the embedding write failed --
    // the two are independent best-effort side effects, not one guarding
    // the other.
    expect(deleteObjectSafely).toHaveBeenCalledWith("https://x/y.jpg");
  });

  // Phase 11-4C: clearing now also removes every PostImage row, not just
  // the imageUrl cache column -- a post can legitimately end up with zero
  // images (a fully-supported state, not an error).
  it("cleans up every PostImage row's Storage object too, deduped against the cache URL", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://cover.jpg" });
    postImage.findMany.mockResolvedValueOnce([
      { imageUrl: "https://cover.jpg" },
      { imageUrl: "https://second.jpg" },
    ]);

    await clearPostImage("found", 1, 1);

    expect(postImage.deleteMany).toHaveBeenCalledWith({ where: { foundPostId: 1 } });
    expect(deleteObjectSafely).toHaveBeenCalledWith("https://cover.jpg");
    expect(deleteObjectSafely).toHaveBeenCalledWith("https://second.jpg");
    expect(deleteObjectSafely).toHaveBeenCalledTimes(2); // deduped, not 3
  });
});

describe("reorderPostImages", () => {
  it("returns not_found for a nonexistent post", async () => {
    lostPost.findUnique.mockResolvedValueOnce(null);
    const result = await reorderPostImages("lost", 1, 1, [10, 11]);
    expect(result).toEqual({ kind: "not_found" });
  });

  it("rejects reordering someone else's post", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x" });
    const result = await reorderPostImages("lost", 1, 2, [10, 11]);
    expect(result).toEqual({ kind: "forbidden" });
    expect(postImage.update).not.toHaveBeenCalled();
  });

  it("rejects an imageIds list that omits one of the post's current images", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x" });
    postImage.findMany.mockResolvedValueOnce([{ id: 10 }, { id: 11 }, { id: 12 }]);

    const result = await reorderPostImages("lost", 1, 1, [10, 11]);

    expect(result).toEqual({ kind: "invalid_order" });
    expect(postImage.update).not.toHaveBeenCalled();
  });

  it("rejects an imageIds list naming an id from a different post", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x" });
    postImage.findMany.mockResolvedValueOnce([{ id: 10 }, { id: 11 }]);

    const result = await reorderPostImages("lost", 1, 1, [10, 999]);

    expect(result).toEqual({ kind: "invalid_order" });
    expect(postImage.update).not.toHaveBeenCalled();
  });

  it("reassigns displayOrder to match the requested order and makes index 0 primary", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://a" });
    postImage.findMany.mockResolvedValueOnce([{ id: 10 }, { id: 11 }, { id: 12 }]);
    postImage.update
      .mockResolvedValueOnce({ id: 12, imageUrl: "https://c", displayOrder: 0, isPrimary: true })
      .mockResolvedValueOnce({ id: 10, imageUrl: "https://a", displayOrder: 1, isPrimary: false })
      .mockResolvedValueOnce({ id: 11, imageUrl: "https://b", displayOrder: 2, isPrimary: false });

    const result = await reorderPostImages("lost", 1, 1, [12, 10, 11]);

    expect(postImage.update).toHaveBeenNthCalledWith(1, { where: { id: 12 }, data: { displayOrder: 0, isPrimary: true } });
    expect(postImage.update).toHaveBeenNthCalledWith(2, { where: { id: 10 }, data: { displayOrder: 1, isPrimary: false } });
    expect(postImage.update).toHaveBeenNthCalledWith(3, { where: { id: 11 }, data: { displayOrder: 2, isPrimary: false } });
    expect(lostPost.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { imageUrl: "https://c" } });
    expect(result).toEqual({
      kind: "ok",
      data: {
        images: [
          { id: 12, imageUrl: "https://c", displayOrder: 0, isPrimary: true },
          { id: 10, imageUrl: "https://a", displayOrder: 1, isPrimary: false },
          { id: 11, imageUrl: "https://b", displayOrder: 2, isPrimary: false },
        ],
        imageUrl: "https://c",
      },
    });
  });
});
