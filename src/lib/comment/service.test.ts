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
// Phase C-2: createComment() now runs its create (+ optional reply
// notification) inside prisma.$transaction -- same tx-mock shape as
// chat/service.test.ts's own $transaction mock, just handing back
// `comment`/`notification` themselves as `tx` (this file's tests only
// ever assert against comment.create/notification.create directly, same
// as before the transaction wrap).
const notification = { create: vi.fn() };
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ comment, notification }));

vi.mock("@/lib/db/prisma", () => ({ prisma: { comment, lostPost, foundPost, notification, $transaction } }));
// Mocked wholesale (not via importActual): moderation/service.ts's own
// import chain (report/service.ts, report/targets.ts, generated Prisma
// enums) has nothing to do with what this file tests -- isAdmin() is a
// pure `user.isAdmin` check, so a minimal fake is all that's needed, same
// convention as this project's other tests mocking a heavy sibling module
// wholesale (e.g. posts/service.test.ts mocking @/lib/ai/postEmbedding).
vi.mock("@/lib/moderation/service", () => ({
  isAdmin: (user: { isAdmin: boolean }) => user.isAdmin,
}));
// Same convention as chat/service.test.ts's own mock of this module --
// only the one enum member this file actually exercises is stubbed.
vi.mock("@/generated/prisma/client", () => ({
  NotificationType: { COMMENT_REPLY: "COMMENT_REPLY" },
}));

const { createComment, deleteComment, getCommentPostRef, listCommentsForPost, updateComment } = await import(
  "./service"
);

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

  it("creates a reply attached to an existing top-level comment on the same post", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1 });
    comment.findUnique.mockResolvedValueOnce({
      id: 50,
      parentId: null,
      authorUserId: 2,
      lostPostId: 1,
      foundPostId: null,
    });
    comment.create.mockResolvedValueOnce({
      id: 51,
      content: "네 맞아요!",
      createdAt: new Date(),
      updatedAt: new Date(),
      parentId: 50,
      author: { id: 1, nickname: "닉네임" },
    });

    const result = await createComment(author, "lost", 1, { content: "네 맞아요!", parentId: 50 });

    expect(result.kind).toBe("ok");
    expect(comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authorUserId: 1, lostPostId: 1, parentId: 50 }),
      }),
    );
  });

  it("returns parent_not_found when parentId doesn't exist", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1 });
    comment.findUnique.mockResolvedValueOnce(null);

    const result = await createComment(author, "lost", 1, { content: "내용", parentId: 999 });

    expect(result).toEqual({ kind: "parent_not_found" });
    expect(comment.create).not.toHaveBeenCalled();
  });

  it("returns parent_not_found when parentId belongs to a different post", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1 });
    comment.findUnique.mockResolvedValueOnce({
      id: 50,
      parentId: null,
      authorUserId: 2,
      lostPostId: 2, // a different LostPost than the one being commented on (id 1)
      foundPostId: null,
    });

    const result = await createComment(author, "lost", 1, { content: "내용", parentId: 50 });

    expect(result).toEqual({ kind: "parent_not_found" });
    expect(comment.create).not.toHaveBeenCalled();
  });

  it("rejects replying to a comment that is itself already a reply", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1 });
    comment.findUnique.mockResolvedValueOnce({
      id: 51,
      parentId: 50, // already a reply -- only one level of nesting is allowed
      authorUserId: 2,
      lostPostId: 1,
      foundPostId: null,
    });

    const result = await createComment(author, "lost", 1, { content: "내용", parentId: 51 });

    expect(result).toEqual({ kind: "reply_to_reply" });
    expect(comment.create).not.toHaveBeenCalled();
  });

  it("notifies the parent comment's author when a reply is created", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1 });
    comment.findUnique.mockResolvedValueOnce({
      id: 50,
      parentId: null,
      authorUserId: 2,
      lostPostId: 1,
      foundPostId: null,
    });
    comment.create.mockResolvedValueOnce({
      id: 51,
      content: "네 맞아요!",
      createdAt: new Date(),
      updatedAt: new Date(),
      parentId: 50,
      author: { id: 1, nickname: "답변자" },
    });

    await createComment(author, "lost", 1, { content: "네 맞아요!", parentId: 50 });

    expect(notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 2,
          type: "COMMENT_REPLY",
          relatedType: "comment",
          relatedId: 51,
        }),
      }),
    );
  });

  it("does not notify when replying to your own comment", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1 });
    comment.findUnique.mockResolvedValueOnce({
      id: 50,
      parentId: null,
      authorUserId: 1, // same as the replier below
      lostPostId: 1,
      foundPostId: null,
    });
    comment.create.mockResolvedValueOnce({
      id: 51,
      content: "제 댓글에 제가 답글",
      createdAt: new Date(),
      updatedAt: new Date(),
      parentId: 50,
      author: { id: 1, nickname: "닉네임" },
    });

    const result = await createComment(author, "lost", 1, { content: "제 댓글에 제가 답글", parentId: 50 });

    expect(result.kind).toBe("ok");
    expect(notification.create).not.toHaveBeenCalled();
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

// Phase E-4
describe("getCommentPostRef", () => {
  it("resolves a comment on a LostPost", async () => {
    comment.findUnique.mockResolvedValueOnce({ lostPostId: 5, foundPostId: null });

    const ref = await getCommentPostRef(10);

    expect(ref).toEqual({ postId: 5, postType: "lost" });
    expect(comment.findUnique).toHaveBeenCalledWith({
      where: { id: 10 },
      select: { lostPostId: true, foundPostId: true },
    });
  });

  it("resolves a comment on a FoundPost", async () => {
    comment.findUnique.mockResolvedValueOnce({ lostPostId: null, foundPostId: 7 });

    const ref = await getCommentPostRef(11);

    expect(ref).toEqual({ postId: 7, postType: "found" });
  });

  it("returns null for a nonexistent comment", async () => {
    comment.findUnique.mockResolvedValueOnce(null);
    expect(await getCommentPostRef(999)).toBeNull();
  });
});
