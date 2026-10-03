// Client-side mirror of comment/remove.ts's removeCommentInTx, applied to
// CommentSection's local state after a successful DELETE so the thread
// matches the server without a reload:
// - a comment with replies becomes a tombstone (content "", isDeleted);
// - a comment without replies is removed, and any tombstoned ancestors
//   left with no replies are removed too.
// Other users' replies are never removed.
type RemovableComment = { id: number; parentId: number | null; content: string; isDeleted: boolean };

export function applyCommentRemoval<T extends RemovableComment>(comments: T[], commentId: number): T[] {
  const hasReplies = (id: number, list: T[]) => list.some((c) => c.parentId === id);

  if (hasReplies(commentId, comments)) {
    return comments.map((c) => (c.id === commentId ? { ...c, content: "", isDeleted: true } : c));
  }

  const byId = new Map(comments.map((c) => [c.id, c]));
  let next = comments.filter((c) => c.id !== commentId);
  let parentId = byId.get(commentId)?.parentId ?? null;
  while (parentId !== null) {
    const parent = byId.get(parentId);
    if (!parent?.isDeleted || hasReplies(parentId, next)) break;
    const removedId: number = parentId;
    next = next.filter((c) => c.id !== removedId);
    parentId = parent.parentId;
  }
  return next;
}
