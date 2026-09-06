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

const deleteObjectSafely = vi.fn();

vi.mock("@/lib/db/prisma", () => ({ prisma: { lostPost, foundPost } }));
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
  listFoundPosts,
  listFoundPostsByUser,
  listLostPosts,
  listLostPostsByUser,
} = await import("./service");

beforeEach(() => {
  vi.clearAllMocks();
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
        user: { id: 1, nickname: "닉네임" },
      },
    ]);
    lostPost.count.mockResolvedValueOnce(1);

    const result = await listLostPosts({ page: 1, limit: 20 });

    expect(lostPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    );
    expect(result.items[0].status).toBe("찾는 중"); // DB enum converted back to legacy Korean value
    expect(result.items[0].author).toEqual({ id: 1, nickname: "닉네임" });
  });

  it("lists found posts", async () => {
    foundPost.findMany.mockResolvedValueOnce([]);
    foundPost.count.mockResolvedValueOnce(0);

    const result = await listFoundPosts({ page: 1, limit: 20 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe("getLostPost", () => {
  it("returns null for a nonexistent post", async () => {
    lostPost.findUnique.mockResolvedValueOnce(null);
    expect(await getLostPost(999)).toBeNull();
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
        user: { id: 7, nickname: "닉네임" },
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
