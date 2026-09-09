import { beforeEach, describe, expect, it, vi } from "vitest";

const lostPost = {
  findMany: vi.fn(),
  count: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
const foundPost = {
  findMany: vi.fn(),
  count: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

// Phase 11-4C: deleteLostPost/deleteFoundPost now also read (and best-effort
// clean up the Storage objects for) every PostImage row a post has, ahead
// of the CASCADE-deleted DB rows -- see this describe block's own new
// tests below.
const postImage = { findMany: vi.fn() };

const deleteObjectSafely = vi.fn();

vi.mock("@/lib/db/prisma", () => ({ prisma: { lostPost, foundPost, postImage } }));
vi.mock("@/generated/prisma/client", () => ({
  LostPostStatus: { SEARCHING: "SEARCHING", FOUND: "FOUND" },
  FoundPostStatus: { KEEPING: "KEEPING", COMPLETED: "COMPLETED" },
}));
// deleteObjectSafely's own error-swallowing is tested in
// src/lib/images/supabaseAdmin.test.ts -- here it's mocked wholesale so
// these tests only assert that posts/service.ts calls it (and in what
// order relative to the DB delete), not how it behaves internally.
vi.mock("@/lib/images/supabaseAdmin", () => ({ deleteObjectSafely }));

// Phase 21: createLostPost/createFoundPost/updateLostPost/updateFoundPost
// (which trigger embedPostBestEffort) moved to ./aiService -- see that
// module's own test file for their coverage. This file now only imports
// (and only needs to mock collaborators for) the plain CRUD/listing
// functions that stayed in ./service, which has no @/lib/ai/* dependency
// at all any more.
const {
  deleteFoundPost,
  deleteLostPost,
  getLostPost,
  getPostStats,
  listFoundPosts,
  listFoundPostsByUser,
  listLostPosts,
  listLostPostsByUser,
  listPostsByUser,
} = await import("./service");

beforeEach(() => {
  vi.clearAllMocks();
  postImage.findMany.mockResolvedValue([]);
});

describe("listLostPosts / listFoundPosts", () => {
  it("lists lost posts ordered newest-first with author info only", async () => {
    lostPost.findMany.mockResolvedValueOnce([
      {
        id: 1,
        title: "t",
        description: "d",
        category: "c",
        location: "l",
        status: "SEARCHING",
        imageUrl: null,
        lostAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { id: 1, nickname: "닉네임", publicId: "pub-1" },
      },
    ]);
    lostPost.count.mockResolvedValueOnce(1);

    const result = await listLostPosts({ page: 1, limit: 20 });

    expect(lostPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    );
    expect(result.items[0].status).toBe("찾는 중"); // DB enum converted back to legacy Korean value
    expect(result.items[0].author).toEqual({ id: 1, nickname: "닉네임", publicId: "pub-1" });
  });

  // Phase 11-4D: listing must not query PostImage at all (see
  // getLostPost's own comment on why *that* function is the only one that
  // does) -- PostCard still reads plain `imageUrl`, so adding this here
  // would be exactly the N+1 query this phase's spec says not to add.
  it("does not include the PostImage relation (no N+1)", async () => {
    lostPost.findMany.mockResolvedValueOnce([]);
    lostPost.count.mockResolvedValueOnce(0);

    await listLostPosts({ page: 1, limit: 20 });

    const call = lostPost.findMany.mock.calls[0][0];
    expect(call.include).not.toHaveProperty("images");
  });

  it("lists found posts", async () => {
    foundPost.findMany.mockResolvedValueOnce([]);
    foundPost.count.mockResolvedValueOnce(0);

    const result = await listFoundPosts({ page: 1, limit: 20 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  // Phase P-5: a 위치/시간 미상 post is a completely normal row from
  // listing's own point of view -- buildSearchWhere/buildOrderBy only ever
  // filter/sort by createdAt (never location/lostAt, see this file's own
  // buildOrderBy), so a null location/lostAt here has zero effect on
  // whether or where this post shows up in a plain list.
  it("lists a location/lostAt-unknown (미상) post exactly like any other", async () => {
    lostPost.findMany.mockResolvedValueOnce([
      {
        id: 1,
        title: "t",
        description: "d",
        category: "c",
        location: null,
        status: "SEARCHING",
        imageUrl: null,
        lostAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { id: 1, nickname: "닉네임", publicId: "pub-1" },
      },
    ]);
    lostPost.count.mockResolvedValueOnce(1);

    const result = await listLostPosts({ page: 1, limit: 20 });

    expect(result.total).toBe(1);
    expect(result.items[0].location).toBeNull();
    expect(result.items[0].lostAt).toBeNull();
  });
});

describe("getLostPost", () => {
  it("returns null for a nonexistent post", async () => {
    lostPost.findUnique.mockResolvedValueOnce(null);
    expect(await getLostPost(999)).toBeNull();
  });

  // Phase 11-4D: this is the one PostDTO-producing query that includes the
  // PostImage relation (see this function's own comment for why the others
  // don't) -- ordered by displayOrder so the detail/edit pages never have
  // to sort it themselves.
  it("includes PostImage rows ordered by displayOrder, and passes them through to the DTO", async () => {
    lostPost.findUnique.mockResolvedValueOnce({
      id: 1,
      title: "t",
      description: "d",
      category: "c",
      location: "l",
      status: "SEARCHING",
      imageUrl: "https://x/b.jpg",
      lostAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임", publicId: "pub-1" },
      images: [
        { id: 11, imageUrl: "https://x/b.jpg", displayOrder: 0, isPrimary: true },
        { id: 12, imageUrl: "https://x/c.jpg", displayOrder: 1, isPrimary: false },
      ],
    });

    const post = await getLostPost(1);

    expect(lostPost.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          images: expect.objectContaining({ orderBy: { displayOrder: "asc" } }),
        }),
      }),
    );
    expect(post?.images).toEqual([
      { id: 11, imageUrl: "https://x/b.jpg", displayOrder: 0, isPrimary: true },
      { id: 12, imageUrl: "https://x/c.jpg", displayOrder: 1, isPrimary: false },
    ]);
  });
});

describe("deleteLostPost / deleteFoundPost", () => {
  it("allows the owner to delete their own post", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    lostPost.delete.mockResolvedValueOnce({});

    const result = await deleteLostPost(1, 1);

    expect(result).toEqual({ kind: "ok", data: { id: 1 } });
    expect(lostPost.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it("cleans up the post's image in Storage on delete", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x/y.jpg" });
    lostPost.delete.mockResolvedValueOnce({});
    deleteObjectSafely.mockResolvedValueOnce(undefined);

    await deleteLostPost(1, 1);

    expect(deleteObjectSafely).toHaveBeenCalledWith("https://x/y.jpg");
  });

  // deleteObjectSafely() never rejects by contract (its own try/catch
  // swallows every failure -- see src/lib/images/supabaseAdmin.test.ts),
  // which is exactly why deleteLostPost()/deleteFoundPost() don't wrap
  // their call to it in a try/catch of their own: there is deliberately
  // only one place that failure-handling logic lives.

  it("rejects deleting someone else's post", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });

    const result = await deleteFoundPost(1, 2);

    expect(result).toEqual({ kind: "forbidden", reason: "not_owner" });
    expect(foundPost.delete).not.toHaveBeenCalled();
  });

  // Phase 28-2: admin/posts.ts::deletePostForAdmin passes { asAdmin: true }
  // to delete a post the caller doesn't own -- every other existing caller
  // never passes this option, so their behavior (tested above) is unchanged.
  it("allows deleting someone else's post when asAdmin is true", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 99, imageUrl: "https://x/y.jpg" });
    lostPost.delete.mockResolvedValueOnce({});

    const result = await deleteLostPost(1, 1, { asAdmin: true });

    expect(result).toEqual({ kind: "ok", data: { id: 1 } });
    expect(lostPost.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(deleteObjectSafely).toHaveBeenCalledWith("https://x/y.jpg");
  });

  it("still rejects deleting someone else's post when asAdmin is false/omitted", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 99 });

    const result = await deleteFoundPost(1, 1, { asAdmin: false });

    expect(result).toEqual({ kind: "forbidden", reason: "not_owner" });
    expect(foundPost.delete).not.toHaveBeenCalled();
  });

  // Phase 11-4C: PostImage rows themselves already cascade-delete via the
  // FK (see schema.prisma) -- this only covers the Storage side, which the
  // cascade never touches.
  it("cleans up every PostImage row's Storage object on delete, not just the imageUrl cache", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: "https://x/cover.jpg" });
    lostPost.delete.mockResolvedValueOnce({});
    postImage.findMany.mockResolvedValueOnce([
      { imageUrl: "https://x/cover.jpg" },
      { imageUrl: "https://x/second.jpg" },
      { imageUrl: "https://x/third.jpg" },
    ]);

    await deleteLostPost(1, 1);

    expect(postImage.findMany).toHaveBeenCalledWith({ where: { lostPostId: 1 }, select: { imageUrl: true } });
    expect(deleteObjectSafely).toHaveBeenCalledWith("https://x/cover.jpg");
    expect(deleteObjectSafely).toHaveBeenCalledWith("https://x/second.jpg");
    expect(deleteObjectSafely).toHaveBeenCalledWith("https://x/third.jpg");
    // cover.jpg is both the imageUrl cache and one of the PostImage rows --
    // deduped, so it's only ever deleted once.
    expect(deleteObjectSafely).toHaveBeenCalledTimes(3);
  });

  it("is a no-op Storage-wise when the post never had any images", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, imageUrl: null });
    foundPost.delete.mockResolvedValueOnce({});
    postImage.findMany.mockResolvedValueOnce([]);

    await deleteFoundPost(1, 1);

    expect(deleteObjectSafely).not.toHaveBeenCalled();
  });
});

// Phase 28-2: authorQuery is the one new (purely additive) filter this
// phase adds to buildSearchWhere -- every other filter's existing test
// coverage (q/category/location/status/sort) is unaffected.
describe("listLostPosts authorQuery filter", () => {
  it("filters by the post author's nickname when authorQuery is given", async () => {
    lostPost.findMany.mockResolvedValueOnce([]);
    lostPost.count.mockResolvedValueOnce(0);

    await listLostPosts({ page: 1, limit: 20, authorQuery: "닉네임" });

    expect(lostPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: { nickname: { contains: "닉네임", mode: "insensitive" } },
        }),
      }),
    );
  });

  it("omits the user filter entirely when authorQuery isn't given", async () => {
    lostPost.findMany.mockResolvedValueOnce([]);
    lostPost.count.mockResolvedValueOnce(0);

    await listLostPosts({ page: 1, limit: 20 });

    const call = lostPost.findMany.mock.calls[0][0];
    expect(call.where.user).toBeUndefined();
  });
});

// Phase 9: "내 게시물" page's data source -- both functions filter purely
// by userId (never a client-supplied value, see
// src/app/(main)/posts/mine/page.tsx), so the only things worth testing
// here are "only that user's rows come back" and "no posts -> []" (the
// page renders that as its own empty state, not tested here per this
// project's no-component-rendering-tests convention).
describe("listLostPostsByUser / listFoundPostsByUser", () => {
  it("queries LostPost scoped to the given userId only, newest first", async () => {
    lostPost.findMany.mockResolvedValueOnce([
      {
        id: 1,
        title: "t",
        description: "d",
        category: "c",
        location: "l",
        status: "SEARCHING",
        imageUrl: null,
        lostAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { id: 7, nickname: "닉네임", publicId: "pub-7" },
      },
    ]);

    const result = await listLostPostsByUser(7);

    expect(lostPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 7 },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].author.id).toBe(7);
  });

  it("returns an empty array for a user with no LostPost posts", async () => {
    lostPost.findMany.mockResolvedValueOnce([]);
    expect(await listLostPostsByUser(7)).toEqual([]);
  });

  it("queries FoundPost scoped to the given userId only", async () => {
    foundPost.findMany.mockResolvedValueOnce([]);

    await listFoundPostsByUser(7);

    expect(foundPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 7 } }),
    );
  });

  it("returns an empty array for a user with no FoundPost posts", async () => {
    foundPost.findMany.mockResolvedValueOnce([]);
    expect(await listFoundPostsByUser(7)).toEqual([]);
  });
});

describe("listPostsByUser", () => {
  const lostRow = (id: number, createdAt: Date) => ({
    id,
    title: `lost-${id}`,
    description: "d",
    category: "c",
    location: "l",
    status: "SEARCHING",
    imageUrl: null,
    lostAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    user: { id: 7, nickname: "닉네임", publicId: "pub-7" },
  });
  const foundRow = (id: number, createdAt: Date) => ({
    id,
    title: `found-${id}`,
    description: "d",
    category: "c",
    location: "l",
    status: "KEEPING",
    imageUrl: null,
    foundAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    user: { id: 7, nickname: "닉네임", publicId: "pub-7" },
  });

  it("merges LostPost + FoundPost for the given userId, newest first, paginated", async () => {
    lostPost.findMany.mockResolvedValueOnce([lostRow(2, new Date("2026-01-03")), lostRow(1, new Date("2026-01-01"))]);
    foundPost.findMany.mockResolvedValueOnce([foundRow(3, new Date("2026-01-02"))]);
    lostPost.count.mockResolvedValueOnce(2);
    foundPost.count.mockResolvedValueOnce(1);

    const result = await listPostsByUser(7, { page: 1, limit: 20 });

    expect(lostPost.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 7 } }));
    expect(foundPost.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 7 } }));
    expect(lostPost.count).toHaveBeenCalledWith({ where: { userId: 7 } });
    expect(foundPost.count).toHaveBeenCalledWith({ where: { userId: 7 } });
    // Newest first across both tables, not grouped by type.
    expect(result.items.map((p) => p.id)).toEqual([2, 3, 1]);
    expect(result.total).toBe(3);
    expect(result.totalPages).toBe(1);
  });

  it("slices the merged, sorted result to the requested page", async () => {
    lostPost.findMany.mockResolvedValueOnce([lostRow(2, new Date("2026-01-02")), lostRow(1, new Date("2026-01-01"))]);
    foundPost.findMany.mockResolvedValueOnce([]);
    lostPost.count.mockResolvedValueOnce(2);
    foundPost.count.mockResolvedValueOnce(0);

    const result = await listPostsByUser(7, { page: 2, limit: 1 });

    expect(result.items.map((p) => p.id)).toEqual([1]);
    expect(result.page).toBe(2);
    expect(result.totalPages).toBe(2);
  });

  it("returns an empty page for a user with no posts", async () => {
    lostPost.findMany.mockResolvedValueOnce([]);
    foundPost.findMany.mockResolvedValueOnce([]);
    lostPost.count.mockResolvedValueOnce(0);
    foundPost.count.mockResolvedValueOnce(0);

    const result = await listPostsByUser(7, { page: 1, limit: 20 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});

// Phase P-4: the logged-out landing page's real-DB stat counts (see
// components/home/landing/LandingStats.tsx) -- these are plain COUNT
// queries, never a fabricated number, so the tests just check the right
// counts feed the right fields.
describe("getPostStats", () => {
  it("returns the total lost/found counts and the combined recent (7-day) count", async () => {
    lostPost.count.mockResolvedValueOnce(11); // total lost
    foundPost.count.mockResolvedValueOnce(9); // total found
    lostPost.count.mockResolvedValueOnce(2); // recent lost
    foundPost.count.mockResolvedValueOnce(3); // recent found

    const stats = await getPostStats();

    expect(stats).toEqual({ lostCount: 11, foundCount: 9, recentCount: 5 });
  });

  it("scopes the recent counts to createdAt >= a 7-day-ago cutoff", async () => {
    const start = new Date("2026-03-10T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(start);
    try {
      lostPost.count.mockResolvedValueOnce(0);
      foundPost.count.mockResolvedValueOnce(0);
      lostPost.count.mockResolvedValueOnce(0);
      foundPost.count.mockResolvedValueOnce(0);

      await getPostStats();

      const expectedSince = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);
      expect(lostPost.count).toHaveBeenNthCalledWith(2, { where: { createdAt: { gte: expectedSince } } });
      expect(foundPost.count).toHaveBeenNthCalledWith(2, { where: { createdAt: { gte: expectedSince } } });
    } finally {
      vi.useRealTimers();
    }
  });
});
