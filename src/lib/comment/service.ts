import { prisma } from "@/lib/db/prisma";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { isAdmin } from "@/lib/moderation/service";
import type { PostType } from "@/lib/posts/schema";
import { NotificationType, type User } from "@/generated/prisma/client";
import type { CreateCommentInput, UpdateCommentInput } from "./schema";

// Phase 23. Comment rows point at exactly one of LostPost/FoundPost via
// two nullable real FKs (see schema.prisma's own comment on why -- same
// shape as ChatRoom's direct* columns), so listing/creating always needs
// to know which column to use; that's what `type` means everywhere in
// this file, same convention as posts/service.ts and match/service.ts.

export type CommentDTO = {
  id: number;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  // Phase C-2: null for a top-level comment, the parent comment's id for a
  // reply. Never points at another reply -- see createComment's own
  // depth check -- so a client can group replies under their parent with
  // a single pass, no recursion needed.
  parentId: number | null;
  author: { id: number; nickname: string | null };
};

export type CommentMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "post_not_found" }
  // Phase C-2: parentId refers to a row that doesn't exist, or that
  // belongs to a different post than the one being commented on (both
  // treated identically -- from the caller's perspective there is no
  // valid parent to reply to either way).
  | { kind: "parent_not_found" }
  | { kind: "forbidden"; reason: "not_owner" | "suspended" | "not_admin" };

const AUTHOR_SELECT = { id: true, nickname: true } as const;

function toCommentDTO(row: {
  id: number;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  parentId: number | null;
  author: { id: number; nickname: string | null };
}): CommentDTO {
  return row;
}

async function postExists(type: PostType, postId: number): Promise<boolean> {
  const row =
    type === "lost"
      ? await prisma.lostPost.findUnique({ where: { id: postId }, select: { id: true } })
      : await prisma.foundPost.findUnique({ where: { id: postId }, select: { id: true } });
  return row !== null;
}

// Oldest-first, matching the example thread in this phase's own spec
// (earlier comments read top-to-bottom before later ones) -- capped at a
// generous flat limit rather than building real pagination, which this
// phase's own spec explicitly says not to over-engineer. If a post ever
// legitimately gets more than this many comments, showing only the first
// COMMENT_LIST_CAP is an acceptable, documented trade-off, not a bug.
const COMMENT_LIST_CAP = 200;

export async function listCommentsForPost(type: PostType, postId: number): Promise<CommentDTO[]> {
  const rows = await prisma.comment.findMany({
    where: type === "lost" ? { lostPostId: postId } : { foundPostId: postId },
    orderBy: { createdAt: "asc" },
    take: COMMENT_LIST_CAP,
    include: { author: { select: AUTHOR_SELECT } },
  });
  return rows.map(toCommentDTO);
}

// Login required (checked by the caller via requireUserForApi before this
// is ever reached -- same convention as createLostPost/createFoundPost),
// suspended users blocked the same way post creation already blocks them.
export async function createComment(
  author: User,
  type: PostType,
  postId: number,
  input: CreateCommentInput,
): Promise<CommentMutationResult<CommentDTO>> {
  if (isCurrentlySuspended(author)) {
    return { kind: "forbidden", reason: "suspended" };
  }
  if (!(await postExists(type, postId))) {
    return { kind: "post_not_found" };
  }

  // Phase H-3: resolved once, up front, so the notification recipient
  // (further down) reads the same row -- no second query needed at
  // notification time. Unlike Phase C-2, there is no depth check anymore
  // -- a reply's parent can itself be a reply, at any depth, since
  // Comment.parentId already supports an arbitrary chain and onDelete:
  // Cascade already handles a whole subtree disappearing together (see
  // schema.prisma's own comment on that column, updated for this phase).
  let parent: { id: number; parentId: number | null; authorUserId: number } | null = null;
  if (input.parentId !== undefined) {
    const parentRow = await prisma.comment.findUnique({
      where: { id: input.parentId },
      select: { id: true, parentId: true, authorUserId: true, lostPostId: true, foundPostId: true },
    });
    // Missing, or attached to a different post than this reply targets --
    // both are "no valid parent here" from the caller's point of view.
    const belongsToThisPost =
      parentRow !== null && (type === "lost" ? parentRow.lostPostId === postId : parentRow.foundPostId === postId);
    if (!parentRow || !belongsToThisPost) return { kind: "parent_not_found" };
    parent = parentRow;
  }

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: {
        content: input.content,
        authorUserId: author.id,
        parentId: parent?.id ?? null,
        ...(type === "lost" ? { lostPostId: postId } : { foundPostId: postId }),
      },
      include: { author: { select: AUTHOR_SELECT } },
    });

    // Never notify yourself for replying to your own comment -- same
    // "no self-notification" rule as chat/service.ts's own message
    // notification (see that file's comment on the self-match case).
    if (parent && parent.authorUserId !== author.id) {
      await tx.notification.create({
        data: {
          userId: parent.authorUserId,
          type: NotificationType.COMMENT_REPLY,
          title: "댓글에 답글이 달렸습니다",
          content: `${author.nickname ?? "누군가"}님이 회원님의 댓글에 답글을 남겼습니다.`,
          relatedType: "comment",
          relatedId: created.id,
        },
      });
    }

    return created;
  });
  return { kind: "ok", data: toCommentDTO(row) };
}

async function findOwnedComment(id: number) {
  return prisma.comment.findUnique({
    where: { id },
    include: { author: { select: AUTHOR_SELECT } },
  });
}

// Self-edit only -- no admin override (this phase's spec only asks for
// admin *delete*, see deleteComment below). Ownership is verified here,
// server-side, regardless of what the UI does or doesn't show a button
// for.
export async function updateComment(
  requesterId: number,
  id: number,
  input: UpdateCommentInput,
): Promise<CommentMutationResult<CommentDTO>> {
  const existing = await findOwnedComment(id);
  if (!existing) return { kind: "not_found" };
  if (existing.authorUserId !== requesterId) {
    return { kind: "forbidden", reason: "not_owner" };
  }

  const row = await prisma.comment.update({
    where: { id },
    data: { content: input.content },
    include: { author: { select: AUTHOR_SELECT } },
  });
  return { kind: "ok", data: toCommentDTO(row) };
}

// Comment author OR admin -- never anyone else. Admin deletion here is a
// direct moderation action, not routed through Report/ModerationAction:
// ModerationAction.reportId is a required, unique FK to an actual Report
// row (see schema.prisma), so it structurally cannot record an action
// with no corresponding report, and this phase's own spec explicitly says
// not to build a full comment-reporting system just to make that possible
// (see this phase's report for the full reasoning).
export async function deleteComment(
  requester: User,
  id: number,
): Promise<CommentMutationResult<{ id: number }>> {
  const existing = await findOwnedComment(id);
  if (!existing) return { kind: "not_found" };

  const isOwner = existing.authorUserId === requester.id;
  if (!isOwner && !isAdmin(requester)) {
    return { kind: "forbidden", reason: "not_owner" };
  }

  await prisma.comment.delete({ where: { id } });
  return { kind: "ok", data: { id } };
}

export async function countCommentsForPost(type: PostType, postId: number): Promise<number> {
  return prisma.comment.count({
    where: type === "lost" ? { lostPostId: postId } : { foundPostId: postId },
  });
}

// Phase E-4: resolves a COMMENT_REPLY notification's relatedId (a Comment
// id -- see createComment()'s own `relatedId: created.id` above, always
// the reply itself, never its parent) to the post it belongs to. Mirrors
// chat/service.ts's own getMessage(): deliberately returns only
// postId/postType, no content/author, and performs no authorization of
// its own -- comment/post reads are public in this app (see
// listCommentsForPost's own callers), so there's nothing to gate here;
// the caller (resolveHref) just needs enough to build a link.
export async function getCommentPostRef(
  commentId: number,
): Promise<{ postId: number; postType: PostType } | null> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { lostPostId: true, foundPostId: true },
  });
  if (!comment) return null;
  if (comment.lostPostId !== null) return { postId: comment.lostPostId, postType: "lost" };
  if (comment.foundPostId !== null) return { postId: comment.foundPostId, postType: "found" };
  return null;
}
