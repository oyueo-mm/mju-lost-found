import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/generated/prisma/client";

const comment = {
  findMany: vi.fn(),
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  count: vi.fn(),
};
const lostPost = { findUnique: vi.fn() };
const foundPost = { findUnique: vi.fn() };

vi.mock("@/lib/db/prisma", () => ({ prisma: { comment, lostPost, foundPost } }));
// Mocked wholesale (not via importActual): moderation/service.ts's own
// import chain (report/service.ts, report/targets.ts, generated Prisma
// enums) has nothing to do with what this file tests -- isAdmin() is a
// pure `user.isAdmin` check, so a minimal fake is all that's needed, same
// convention as this project's other tests mocking a heavy sibling module
// wholesale (e.g. posts/service.test.ts mocking @/lib/ai/postEmbedding).
vi.mock("@/lib/moderation/service", () => ({
  isAdmin: (user: { isAdmin: boolean }) => user.isAdmin,
}));

const { createComment, deleteComment, listCommentsForPost, updateComment } = await import("./service");

const author = { id: 1, isSuspended: false, suspendedUntil: null, isAdmin: false } as unknown as User;
const suspendedAuthor = { ...author, isSuspended: true } as unknown as User;
const admin = { id: 2, isSuspended: false, suspendedUntil: null, isAdmin: true } as unknown as User;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listCommentsForPost", () => {
  it("lists comments for a LostPost oldest-first", async () => {
    comment.findMany.mockResolvedValueOnce([]);

    await listCommentsForPost("lost", 5);

    expect(comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { lostPostId: 5 }, orderBy: { createdAt: "asc" } }),
    );
  });

  it("lists comments for a FoundPost using the other column", async () => {
    comment.findMany.mockResolvedValueOnce([]);

    await listCommentsForPost("found", 5);

    expect(comment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { foundPostId: 5 } }));
  });
});

describe("createComment", () => {
  it("rejects a suspended author without writing to the DB", async () => {
    const result = await createComment(suspendedAuthor, "lost", 1, { content: "안녕하세요" });

    expect(result).toEqual({ kind: "forbidden", reason: "suspended" });
    expect(comment.create).not.toHaveBeenCalled();
  });

  it("returns post_not_found when the target post doesn't exist", async () => {
    lostPost.findUnique.mockResolvedValueOnce(null);

    const result = await createComment(author, "lost", 999, { content: "안녕하세요" });

    expect(result).toEqual({ kind: "post_not_found" });
    expect(comment.create).not.toHaveBeenCalled();
  });

  it("creates a comment attributed to the requester, on the right post column", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1 });
    comment.create.mockResolvedValueOnce({
      id: 10,
      content: "혹시 도서관에서 잃어버리신 건가요?",
      createdAt: new Date(),
      updatedAt: new Date(),
      author: { id: 1, nickname: "닉네임" },
    });

    await createComment(author, "lost", 1, { content: "혹시 도서관에서 잃어버리신 건가요?" });

    expect(comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authorUserId: 1, lostPostId: 1 }),
      }),
    );
  });
});

describe("updateComment", () => {
  it("allows the author to edit their own comment", async () => {
    comment.findUnique.mockResolvedValueOnce({ id: 10, authorUserId: 1, author: { id: 1, nickname: "닉네임" } });
    comment.update.mockResolvedValueOnce({
      id: 10,
      content: "수정된 내용",
      createdAt: new Date(),
      updatedAt: new Date(),
      author: { id: 1, nickname: "닉네임" },
    });

    const result = await updateComment(1, 10, { content: "수정된 내용" });

    expect(result.kind).toBe("ok");
  });

  it("rejects editing someone else's comment, even for an admin", async () => {
    comment.findUnique.mockResolvedValueOnce({ id: 10, authorUserId: 1, author: { id: 1, nickname: "닉네임" } });

    const result = await updateComment(2, 10, { content: "해킹 시도" });

    expect(result).toEqual({ kind: "forbidden", reason: "not_owner" });
    expect(comment.update).not.toHaveBeenCalled();
  });

  it("reports not_found for a nonexistent comment", async () => {
    comment.findUnique.mockResolvedValueOnce(null);
    expect(await updateComment(1, 999, { content: "x" })).toEqual({ kind: "not_found" });
  });
});

describe("deleteComment", () => {
  it("allows the author to delete their own comment", async () => {
    comment.findUnique.mockResolvedValueOnce({ id: 10, authorUserId: 1, author: { id: 1, nickname: "닉네임" } });
    comment.delete.mockResolvedValueOnce({});

    const result = await deleteComment(author, 10);

    expect(result).toEqual({ kind: "ok", data: { id: 10 } });
    expect(comment.delete).toHaveBeenCalledWith({ where: { id: 10 } });
  });

  it("allows an admin to delete someone else's comment", async () => {
    comment.findUnique.mockResolvedValueOnce({ id: 10, authorUserId: 1, author: { id: 1, nickname: "닉네임" } });
    comment.delete.mockResolvedValueOnce({});

    const result = await deleteComment(admin, 10);

    expect(result).toEqual({ kind: "ok", data: { id: 10 } });
  });

  it("rejects a non-owner, non-admin user", async () => {
    comment.findUnique.mockResolvedValueOnce({ id: 10, authorUserId: 1, author: { id: 1, nickname: "닉네임" } });
    const otherUser = { id: 3, isSuspended: false, suspendedUntil: null, isAdmin: false } as unknown as User;

    const result = await deleteComment(otherUser, 10);

    expect(result).toEqual({ kind: "forbidden", reason: "not_owner" });
    expect(comment.delete).not.toHaveBeenCalled();
  });

  it("reports not_found for a nonexistent comment", async () => {
    comment.findUnique.mockResolvedValueOnce(null);
    expect(await deleteComment(author, 999)).toEqual({ kind: "not_found" });
  });
});
