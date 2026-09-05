import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/generated/prisma/client";

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

const {
  createFoundPost,
  createLostPost,
  deleteFoundPost,
  deleteLostPost,
  getLostPost,
  listFoundPosts,
  listLostPosts,
  updateFoundPost,
  updateLostPost,
} = await import("./service");

// A minimal stand-in for the Prisma User type -- these tests only exercise
// service.ts's own logic (author id, suspension check), never Prisma
// itself (mocked above), so the full User shape isn't needed.
const author = {
  id: 1,
  email: "author@mju.ac.kr",
  isSuspended: false,
  suspendedUntil: null,
} as unknown as User;

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

describe("createLostPost / createFoundPost", () => {
  it("sets the author from the session user, not from the input", async () => {
    lostPost.create.mockResolvedValueOnce({
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
    });

    await createLostPost(author, {
      title: "t",
      description: "d",
      category: "c",
      location: "l",
      lostAt: new Date(),
    });

    expect(lostPost.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: author.id }) }),
    );
  });

  it("rejects post creation for a suspended user without writing to the DB", async () => {
    const suspended = { ...author, isSuspended: true, suspendedUntil: null };

    const result = await createFoundPost(suspended, {
      title: "t",
      description: "d",
      category: "c",
      location: "l",
      foundAt: new Date(),
    });

    expect(result).toEqual({ kind: "forbidden", reason: "suspended" });
    expect(foundPost.create).not.toHaveBeenCalled();
  });
});

describe("updateLostPost", () => {
  it("allows the owner to update their own post", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    lostPost.update.mockResolvedValueOnce({
      id: 1,
      title: "새 제목",
      description: "d",
      category: "c",
      location: "l",
      status: "SEARCHING",
      imageUrl: null,
      lostAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
    });

    const result = await updateLostPost(1, 1, { title: "새 제목" });

    expect(result.kind).toBe("ok");
  });

  it("rejects updating someone else's post", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });

    const result = await updateLostPost(1, 2, { title: "해킹 시도" });

    expect(result).toEqual({ kind: "forbidden", reason: "not_owner" });
    expect(lostPost.update).not.toHaveBeenCalled();
  });

  it("reports not_found for a nonexistent post", async () => {
    lostPost.findUnique.mockResolvedValueOnce(null);
    expect(await updateLostPost(999, 1, { title: "x" })).toEqual({ kind: "not_found" });
  });

  it("rejects updating someone else's FoundPost the same way", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 2, userId: 1 });

    const result = await updateFoundPost(2, 2, { title: "해킹 시도" });

    expect(result).toEqual({ kind: "forbidden", reason: "not_owner" });
    expect(foundPost.update).not.toHaveBeenCalled();
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
});
