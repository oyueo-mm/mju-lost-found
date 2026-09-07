"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { PostType } from "@/lib/posts/schema";
import { Button } from "@/components/ui/Button";
import { ChatBubbleIcon } from "@/components/icons";
import { ReportButton } from "@/components/report/ReportButton";

type CommentAuthor = { id: number; nickname: string | null };
type CommentDTO = {
  id: number;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  // Phase C-2: null for a top-level comment, the parent comment's id for a
  // reply. Never points at another reply (server-enforced, one level
  // only) -- see comment/service.ts's createComment.
  parentId: number | null;
  author: CommentAuthor;
};

type CommentSectionProps = {
  postType: PostType;
  postId: number;
  initialComments: CommentDTO[];
  currentUser: { id: number } | null;
  isAdmin: boolean;
};

// Coarse, Korean-labeled relative time -- matches this phase's own mockup
// ("2시간 전"/"1시간 전"), not a general-purpose i18n date library (no new
// dependency for a handful of buckets).
function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

const COMMENT_MAX_LENGTH = 1000;

export function CommentSection({ postType, postId, initialComments, currentUser, isAdmin }: CommentSectionProps) {
  const router = useRouter();
  const [comments, setComments] = useState(initialComments);
  const [newContent, setNewContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [pendingId, setPendingId] = useState<number | null>(null);
  // Phase C-2: which top-level comment's reply form is open (at most one
  // at a time), and that form's own draft/submitting state -- kept
  // separate from newContent/submitting above so writing a reply never
  // clobbers an in-progress top-level comment draft.
  const [replyingToId, setReplyingToId] = useState<number | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || !newContent.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/comments?type=${postType}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "댓글을 작성하지 못했습니다.");
        return;
      }
      setComments((prev) => [...prev, { ...json.data, createdAt: new Date(json.data.createdAt), updatedAt: new Date(json.data.updatedAt) }]);
      setNewContent("");
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  // Phase C-2: same POST endpoint as a top-level comment, just with
  // parentId set -- createComment() on the server does the actual depth
  // enforcement, this only ever calls it with a top-level comment's own
  // id (see the render section: the reply toggle only exists on top-level
  // comments), so a reply-to-a-reply is never even attempted from here.
  async function handleReplySubmit(event: React.FormEvent, parentId: number) {
    event.preventDefault();
    if (replySubmitting || !replyContent.trim()) return;

    setReplySubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/comments?type=${postType}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: replyContent, parentId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "답글을 작성하지 못했습니다.");
        return;
      }
      setComments((prev) => [...prev, { ...json.data, createdAt: new Date(json.data.createdAt), updatedAt: new Date(json.data.updatedAt) }]);
      setReplyContent("");
      setReplyingToId(null);
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setReplySubmitting(false);
    }
  }

  function startEdit(comment: CommentDTO) {
    setEditingId(comment.id);
    setEditContent(comment.content);
  }

  async function handleSaveEdit(commentId: number) {
    if (pendingId !== null || !editContent.trim()) return;
    setPendingId(commentId);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/comments/${commentId}?type=${postType}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "댓글을 수정하지 못했습니다.");
        return;
      }
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? { ...c, content: json.data.content, updatedAt: new Date(json.data.updatedAt) } : c)),
      );
      setEditingId(null);
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(commentId: number) {
    if (pendingId !== null) return;
    if (!confirm("댓글을 삭제하시겠습니까?")) return;

    setPendingId(commentId);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/comments/${commentId}?type=${postType}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "댓글을 삭제하지 못했습니다.");
        return;
      }
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setPendingId(null);
    }
  }

  // Phase C-2: comments come back from the API oldest-first and flat --
  // grouping into "top-level + its replies" here (once, per render) keeps
  // that single flat array/fetch/notification path on the server exactly
  // as it was, and needs no recursion since replies can never have their
  // own replies (server-enforced in createComment).
  const topLevelComments = comments.filter((c) => c.parentId === null);
  const repliesByParentId = new Map<number, CommentDTO[]>();
  for (const c of comments) {
    if (c.parentId === null) continue;
    const list = repliesByParentId.get(c.parentId);
    if (list) list.push(c);
    else repliesByParentId.set(c.parentId, [c]);
  }

  function renderCommentBody(comment: CommentDTO) {
    const isOwner = currentUser?.id === comment.author.id;
    const canDelete = isOwner || isAdmin;
    const isEditing = editingId === comment.id;

    return (
      <>
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">{comment.author.nickname ?? "알 수 없음"}</span>
          <span className="text-xs text-muted-foreground">{formatRelativeTime(comment.createdAt)}</span>
        </div>

        {isEditing ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              maxLength={COMMENT_MAX_LENGTH}
              rows={2}
              className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => handleSaveEdit(comment.id)} disabled={pendingId !== null}>
                {pendingId === comment.id ? "저장 중..." : "저장"}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditingId(null)}>
                취소
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="whitespace-pre-wrap text-foreground">{comment.content}</p>
            {(isOwner || canDelete || currentUser) && (
              <div className="flex flex-wrap items-center gap-3 text-xs">
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => startEdit(comment)}
                    className="text-muted-foreground underline hover:text-foreground"
                  >
                    수정
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => handleDelete(comment.id)}
                    disabled={pendingId !== null}
                    className="text-destructive underline disabled:opacity-60"
                  >
                    {pendingId === comment.id ? "삭제 중..." : "삭제"}
                  </button>
                )}
                {/* Phase C-2: reply toggle only ever appears on a
                    top-level comment (comment.parentId === null) -- a
                    reply has no toggle of its own, which is what keeps
                    nesting capped at one level in the UI as well as the
                    API. */}
                {comment.parentId === null && currentUser && (
                  <button
                    type="button"
                    onClick={() => {
                      setReplyingToId((prev) => (prev === comment.id ? null : comment.id));
                      setReplyContent("");
                    }}
                    className="text-muted-foreground underline hover:text-foreground"
                  >
                    답글
                  </button>
                )}
                {/* Phase C-3: applies to replies too, not just top-level
                    comments -- unlike the 답글 toggle above, there's no
                    depth restriction on who can be reported. Self-reports
                    aren't hidden ahead of time here either, matching
                    ReportButton's existing use on the post detail page
                    (rejected server-side with a normal error instead). */}
                {currentUser && <ReportButton targetType="comment" targetId={comment.id} buttonLabel="신고" />}
              </div>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-6">
      <h2 className="flex items-center gap-1.5 font-semibold text-foreground">
        <ChatBubbleIcon className="size-4.5" />
        댓글 {comments.length}
      </h2>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {topLevelComments.length === 0 ? (
        <p className="text-sm text-muted-foreground">아직 댓글이 없어요. 첫 댓글을 남겨보세요.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {topLevelComments.map((comment) => {
            const replies = repliesByParentId.get(comment.id) ?? [];

            return (
              <div key={comment.id} className="flex flex-col gap-2">
                <div className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
                  {renderCommentBody(comment)}
                </div>

                {replies.length > 0 && (
                  <div className="ml-6 flex flex-col gap-2 border-l border-border pl-3">
                    {replies.map((reply) => (
                      <div key={reply.id} className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
                        {renderCommentBody(reply)}
                      </div>
                    ))}
                  </div>
                )}

                {replyingToId === comment.id && (
                  <form
                    onSubmit={(e) => handleReplySubmit(e, comment.id)}
                    className="ml-6 flex flex-col gap-2 border-l border-border pl-3"
                  >
                    <textarea
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      placeholder="답글을 입력하세요..."
                      maxLength={COMMENT_MAX_LENGTH}
                      rows={2}
                      disabled={replySubmitting}
                      autoFocus
                      className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground disabled:opacity-60"
                    />
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={replySubmitting || !replyContent.trim()}>
                        {replySubmitting ? "작성 중..." : "답글 작성"}
                      </Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => setReplyingToId(null)}>
                        취소
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}

      {currentUser ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="댓글을 입력하세요..."
            maxLength={COMMENT_MAX_LENGTH}
            rows={3}
            disabled={submitting}
            className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground disabled:opacity-60"
          />
          <Button type="submit" size="sm" disabled={submitting || !newContent.trim()} className="self-start">
            {submitting ? "작성 중..." : "댓글 작성"}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-primary hover:opacity-80">
            로그인
          </Link>
          이 필요합니다.
        </p>
      )}
    </div>
  );
}
