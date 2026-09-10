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
// Phase 12-5: organization/service.ts's own import chain (organization/
// authz.ts, generated Prisma enums for OrganizationRole/Status/
// RequestStatus) has nothing to do with what this file tests -- only
// validateOrganizationPosting() is actually called by comment/service.ts,
// so it's stubbed directly, same "mock a heavy sibling module wholesale"
// convention as the moderation/service mock just above.
const validateOrganizationPosting = vi.fn();
vi.mock("@/lib/organization/service", () => ({ validateOrganizationPosting }));
// Same convention as chat/service.test.ts's own mock of this module --
// only the one enum member this file actually exercises is stubbed.
vi.mock("@/generated/prisma/client", () => ({
  NotificationType: { COMMENT_REPLY: "COMMENT_REPLY" },
}));

const { createComment, deleteComment, getCommentPostRef, listCommentsByUser, listCommentsForPost, updateComment } =
  await import("./service");

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

describe("listCommentsByUser", () => {
  it("lists this user's own comments, newest first, with post title/type and reply info", async () => {
    comment.findMany.mockResolvedValueOnce([
      {
        id: 10,
        content: "안녕하세요",
        createdAt: new Date("2026-01-02"),
        parentId: null,
        lostPost: { id: 1, title: "에어팟" },
        foundPost: null,
        parent: null,
      },
      {
        id: 9,
        content: "저도 봤어요",
        createdAt: new Date("2026-01-01"),
        parentId: 5,
        lostPost: null,
        foundPost: { id: 2, title: "지갑" },
        parent: { author: { nickname: "원댓글작성자" } },
      },
    ]);

    const result = await listCommentsByUser(1);

    expect(comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authorUserId: 1 }, orderBy: { createdAt: "desc" } }),
    );
    expect(result).toEqual([
      {
        id: 10,
        content: "안녕하세요",
        createdAt: new Date("2026-01-02"),
        parentId: null,
        replyToNickname: null,
        post: { id: 1, type: "lost", title: "에어팟" },
      },
      {
        id: 9,
        content: "저도 봤어요",
        createdAt: new Date("2026-01-01"),
        parentId: 5,
        replyToNickname: "원댓글작성자",
        post: { id: 2, type: "found", title: "지갑" },
      },
    ]);
  });

  it("returns an empty list when the user has no comments", async () => {
    comment.findMany.mockResolvedValueOnce([]);
    expect(await listCommentsByUser(1)).toEqual([]);
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

  // Phase H-3: replying to a reply is now allowed (unlimited depth) --
  // this is the exact scenario the old "reply_to_reply" rejection used to
  // block; it now succeeds the same way replying to a top-level comment
  // already did.
  it("allows replying to a comment that is itself already a reply (unlimited depth)", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1 });
    comment.findUnique.mockResolvedValueOnce({
      id: 51,
      parentId: 50, // already a reply
      authorUserId: 2,
      lostPostId: 1,
      foundPostId: null,
    });
    comment.create.mockResolvedValueOnce({
      id: 52,
      content: "답글의 답글",
      createdAt: new Date(),
      updatedAt: new Date(),
      parentId: 51,
      author: { id: 1, nickname: "닉네임" },
    });

    const result = await createComment(author, "lost", 1, { content: "답글의 답글", parentId: 51 });

    expect(result.kind).toBe("ok");
    expect(comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authorUserId: 1, lostPostId: 1, parentId: 51 }),
      }),
    );
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

// Phase 12-5 §19/§31/§32: organization attribution on comment creation --
// validateOrganizationPosting() (mocked at the top of this file) is
// exercised the same way as posts/aiService.test.ts's own equivalent
// suite; the specific existence/ACTIVE/membership logic itself is covered
// by organization/service.test.ts's own tests, not duplicated here.
describe("createComment -- organization attribution (Phase 12-5)", () => {
  it("organizationId omitted -- personal comment, validateOrganizationPosting never called", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1 });
    comment.create.mockResolvedValueOnce({
      id: 10,
      content: "댓글입니다",
      createdAt: new Date(),
      updatedAt: new Date(),
      parentId: null,
      author: { id: 1, nickname: "닉네임" },
      organization: null,
    });

    const result = await createComment(author, "lost", 1, { content: "댓글입니다" });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.organizationId).toBeNull();
      expect(result.data.organizationName).toBeNull();
    }
    expect(validateOrganizationPosting).not.toHaveBeenCalled();
    expect(comment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: null }) }),
    );
  });

  it("ACTIVE organization + active member -- succeeds and persists organizationId", async () => {
    validateOrganizationPosting.mockResolvedValueOnce({ kind: "ok" });
    lostPost.findUnique.mockResolvedValueOnce({ id: 1 });
    comment.create.mockResolvedValueOnce({
      id: 10,
      content: "조직 댓글입니다",
      createdAt: new Date(),
      updatedAt: new Date(),
      parentId: null,
      author: { id: 1, nickname: "닉네임" },
      organization: { id: 10, name: "도서관 자치 위원회" },
    });

    const result = await createComment(author, "lost", 1, { content: "조직 댓글입니다", organizationId: 10 });

    expect(validateOrganizationPosting).toHaveBeenCalledWith(author.id, 10);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.organizationId).toBe(10);
      expect(result.data.organizationName).toBe("도서관 자치 위원회");
    }
    expect(comment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: 10 }) }),
    );
  });

  it("non-member -- rejected as forbidden without writing to the DB", async () => {
    validateOrganizationPosting.mockResolvedValueOnce({ kind: "forbidden" });
    lostPost.findUnique.mockResolvedValueOnce({ id: 1 });

    const result = await createComment(author, "lost", 1, { content: "댓글", organizationId: 10 });

    expect(result).toEqual({ kind: "forbidden", reason: "organization_not_member" });
    expect(comment.create).not.toHaveBeenCalled();
  });

  it("INACTIVE organization -- rejected even for an existing member", async () => {
    validateOrganizationPosting.mockResolvedValueOnce({ kind: "inactive_organization" });
    lostPost.findUnique.mockResolvedValueOnce({ id: 1 });

    const result = await createComment(author, "lost", 1, { content: "댓글", organizationId: 10 });

    expect(result).toEqual({ kind: "forbidden", reason: "organization_inactive" });
    expect(comment.create).not.toHaveBeenCalled();
  });

  it("nonexistent organizationId -- not_found", async () => {
    validateOrganizationPosting.mockResolvedValueOnce({ kind: "not_found" });
    lostPost.findUnique.mockResolvedValueOnce({ id: 1 });

    const result = await createComment(author, "lost", 1, { content: "댓글", organizationId: 999999 });

    expect(result).toEqual({ kind: "forbidden", reason: "organization_not_found" });
    expect(comment.create).not.toHaveBeenCalled();
  });

  // §19: the post's own attribution and the comment's organization are
  // deliberately independent -- validateOrganizationPosting is checked
  // purely against the comment's own organizationId, never anything
  // about the post being commented on.
  it("comment organization is independent of the post's own attribution", async () => {
    validateOrganizationPosting.mockResolvedValueOnce({ kind: "ok" });
    lostPost.findUnique.mockResolvedValueOnce({ id: 1 }); // the post itself carries no organization info here
    comment.create.mockResolvedValueOnce({
      id: 10,
      content: "조직 댓글입니다",
      createdAt: new Date(),
      updatedAt: new Date(),
      parentId: null,
      author: { id: 1, nickname: "닉네임" },
      organization: { id: 10, name: "도서관 자치 위원회" },
    });

    const result = await createComment(author, "lost", 1, { content: "조직 댓글입니다", organizationId: 10 });

    expect(result.kind).toBe("ok");
    expect(validateOrganizationPosting).toHaveBeenCalledWith(author.id, 10);
  });

  it("suspended user is rejected before organization validation even runs", async () => {
    const result = await createComment(suspendedAuthor, "lost", 1, { content: "댓글", organizationId: 10 });

    expect(result).toEqual({ kind: "forbidden", reason: "suspended" });
    expect(validateOrganizationPosting).not.toHaveBeenCalled();
    expect(comment.create).not.toHaveBeenCalled();
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

  // Phase 12-5 §20: updateComment only ever writes `content` -- even if a
  // caller somehow constructs an UpdateCommentInput with organizationId on
  // it (bypassing the schema), it's never read.
  it("never changes organizationId even if present on the input object", async () => {
    comment.findUnique.mockResolvedValueOnce({
      id: 10,
      authorUserId: 1,
      author: { id: 1, nickname: "닉네임" },
      organization: { id: 5, name: "원래 조직" },
    });
    comment.update.mockResolvedValueOnce({
      id: 10,
      content: "수정된 내용",
      createdAt: new Date(),
      updatedAt: new Date(),
      author: { id: 1, nickname: "닉네임" },
      organization: { id: 5, name: "원래 조직" },
    });

    await updateComment(1, 10, { content: "수정된 내용", organizationId: 999 } as never);

    const callArgs = comment.update.mock.calls[0][0];
    expect(callArgs.data).not.toHaveProperty("organizationId");
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
