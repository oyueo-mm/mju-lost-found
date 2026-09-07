"use client";

import { useState } from "react";
import Link from "next/link";

import type { PostType } from "@/lib/posts/schema";
import { formatRelativeTime } from "./CommentSection";
import { EmptyState } from "@/components/ui/EmptyState";

type MyCommentDTO = {
  id: number;
  content: string;
  // Passed straight from the Server Component as a real Date -- same
  // convention CommentSection's own initialComments prop already uses,
  // not a serialized string (only a client-side fetch() response needs
  // `new Date(...)`, see CommentSection's own handleSubmit).
  createdAt: Date;
  parentId: number | null;
  replyToNickname: string | null;
  post: { id: number; type: PostType; title: string };
};

const TYPE_LABEL: Record<PostType, string> = { lost: "분실물", found: "습득물" };

// Phase H-8: "내가 쓴 댓글" (/me/comments). Deletion reuses the exact same
// endpoint CommentSection's own handleDelete already calls
// (DELETE /api/posts/[id]/comments/[commentId]?type=...) -- no new/
// duplicate delete route or logic, per this phase's own spec. The [id]
// segment is accepted but unused by that route (a commentId alone is
// enough to find and authorize the row, see comment/service.ts's
// deleteComment) -- this just passes comment.post.id the same way every
// other caller passes *some* post id there.
export function MyCommentList({ comments: initialComments }: { comments: MyCommentDTO[] }) {
  const [comments, setComments] = useState(initialComments);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(comment: MyCommentDTO) {
    if (pendingId !== null) return;
    // Same confirmation copy as CommentSection's own delete button --
    // deleting a top-level comment here cascades its replies exactly the
    // same way (Comment.parentId's onDelete: Cascade), regardless of
    // which UI triggered it.
    if (!confirm("댓글을 삭제하시겠습니까? 이 댓글에 달린 답글도 함께 삭제됩니다.")) return;

    setPendingId(comment.id);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${comment.post.id}/comments/${comment.id}?type=${comment.post.type}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "댓글을 삭제하지 못했습니다.");
        return;
      }
      setComments((prev) => prev.filter((c) => c.id !== comment.id));
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setPendingId(null);
    }
  }

  if (comments.length === 0) {
    return <EmptyState title="작성한 댓글이 없어요." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {comments.map((comment) => (
        <div key={comment.id} className="flex flex-col gap-2 rounded-card border border-border bg-card p-4 text-sm">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
              {TYPE_LABEL[comment.post.type]}
            </span>
            <Link
              href={`/post/${comment.post.id}?type=${comment.post.type}#comment-${comment.id}`}
              className="truncate font-medium text-foreground hover:underline"
            >
              {comment.post.title}
            </Link>
          </div>

          {comment.replyToNickname && (
            <span className="text-xs text-muted-foreground">
              <span className="font-medium text-primary">@{comment.replyToNickname}</span>님에게 남긴 답글
            </span>
          )}

          <p className="whitespace-pre-wrap text-foreground">{comment.content}</p>

          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{formatRelativeTime(comment.createdAt)}</span>
            <div className="flex items-center gap-3">
              <Link
                href={`/post/${comment.post.id}?type=${comment.post.type}#comment-${comment.id}`}
                className="underline hover:text-foreground"
              >
                게시글에서 보기
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(comment)}
                disabled={pendingId !== null}
                className="text-destructive underline disabled:opacity-60"
              >
                {pendingId === comment.id ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
