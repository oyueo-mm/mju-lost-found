import type { Prisma } from "@/generated/prisma/client";

// Kept apart from comment/service.ts so moderation/service.ts can use it
// without an import cycle (comment/service.ts imports moderation/service).
type CommentRemoveTx = Pick<Prisma.TransactionClient, "comment">;

// The one way a comment is removed -- by its author, an admin, or a report
// action (moderation/service.ts). Comment.parentId is ON DELETE CASCADE,
// so a plain delete would also delete every reply under it, usually other
// users' content. Instead:
// - no replies: the row is deleted, as before;
// - has replies: the row stays as a tombstone (content cleared, deletedAt
//   set) and the replies are untouched.
// The "no replies" check and the delete are one statement, so a reply
// that already exists is never cascaded away. Removing a reply can leave
// its tombstoned parent with no replies left; such tombstones are then
// deleted too, walking up the chain.
export async function removeCommentInTx(
  tx: CommentRemoveTx,
  comment: { id: number; parentId: number | null },
): Promise<"deleted" | "tombstoned"> {
  const { count } = await tx.comment.deleteMany({ where: { id: comment.id, replies: { none: {} } } });
  if (count === 0) {
    await tx.comment.update({ where: { id: comment.id }, data: { content: "", deletedAt: new Date() } });
    return "tombstoned";
  }

  let parentId = comment.parentId;
  while (parentId !== null) {
    const parent = await tx.comment.findUnique({ where: { id: parentId }, select: { parentId: true, deletedAt: true } });
    if (!parent?.deletedAt) break;
    const removed = await tx.comment.deleteMany({ where: { id: parentId, replies: { none: {} } } });
    if (removed.count === 0) break;
    parentId = parent.parentId;
  }
  return "deleted";
}
