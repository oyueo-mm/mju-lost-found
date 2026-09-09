"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { PostType } from "@/lib/posts/schema";
import { Button } from "@/components/ui/Button";
import { ChatBubbleIcon } from "@/components/icons";
import { AuthorLink } from "@/components/user/AuthorLink";
import { CommentActionMenu } from "@/components/comment/CommentActionMenu";

type CommentAuthor = { id: number; nickname: string | null; publicId: string };
type CommentDTO = {
  id: number;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  // Phase H-3: null for a top-level comment, the parent comment's id for a
  // reply -- a reply's own parent can now be another reply, at any depth
  // (see comment/service.ts's createComment, which no longer rejects
  // this). The tree is built client-side from this single flat field, no
  // separate depth/path column needed.
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
// dependency for a handful of buckets). Exported (Phase H-8) so
// MyCommentList (내가 쓴 댓글, /me/comments) can show the same "n분 전" style
// timestamp instead of re-implementing this.
export function formatRelativeTime(date: Date): string {
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
// Phase H-3: the actual reply chain depth is unbounded (parentId can point
// arbitrarily deep, see comment/service.ts), but indentation stops growing
// past this many visual levels so a very deep thread never runs a reply off
// the edge of a narrow/mobile viewport -- the @닉네임 tag on each reply is
// what keeps a flattened-looking deep thread readable past this point, not
// indentation.
const MAX_VISUAL_INDENT_DEPTH = 4;
const INDENT_PX_PER_DEPTH = 20;

type CommentNode = CommentDTO & { children: CommentNode[] };

// Builds a tree from the flat parentId list. A comment whose parentId is
// non-null but doesn't resolve to any comment currently in `comments` --
// its parent was deleted (or, defensively, any other reason the client's
// state doesn't have it) -- is rendered as its own root instead of being
// dropped, so a stale/partial client state degrades gracefully instead of
// silently hiding real comments or crashing on a dangling reference.
function buildCommentTree(comments: CommentDTO[]): CommentNode[] {
  const nodesById = new Map<number, CommentNode>(comments.map((c) => [c.id, { ...c, children: [] }]));
  const roots: CommentNode[] = [];
  for (const node of nodesById.values()) {
    const parent = node.parentId !== null ? nodesById.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

// Every id in this comment's own subtree (itself included) -- used to
// purge a deleted comment's replies from local state in one pass, mirroring
// the server's onDelete: Cascade on Comment.parentId (see schema.prisma)
// so the client never shows a reply whose parent it just removed locally.
function collectSubtreeIds(node: CommentNode, into: Set<number>): void {
  into.add(node.id);
  for (const child of node.children) collectSubtreeIds(child, into);
}

export function CommentSection({ postType, postId, initialComments, currentUser, isAdmin }: CommentSectionProps) {
  const router = useRouter();
  const [comments, setComments] = useState(initialComments);
  const [newContent, setNewContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [pendingId, setPendingId] = useState<number | null>(null);
  // Phase H-3: which comment's reply form is open (at most one at a time,
  // now at any depth, not just top-level) -- kept separate from
  // newContent/submitting so writing a reply never clobbers an
  // in-progress top-level comment draft.
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

  // Phase H-3: same POST endpoint as a top-level comment, just with
  // parentId set -- parentId can now be any existing comment on this post
  // (top-level or a reply), not only a top-level one; the server enforces
  // "belongs to this post" and nothing else about depth (see
  // comment/service.ts's createComment).
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

  // Phase 7: confirmation now happens inside CommentActionMenu (same
  // division of labor as chat's deleteMessageById/MessageActionMenu) --
  // this only does the fetch + local-state update, and throws on failure
  // so the menu can show the error inline instead of this component's own
  // top-level `error` banner.
  async function handleDelete(commentId: number) {
    const res = await fetch(`/api/posts/${postId}/comments/${commentId}?type=${postType}`, {
      method: "DELETE",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error ?? "댓글을 삭제하지 못했습니다.");
    }
    // Phase H-3: the server cascades the deleted comment's entire reply
    // subtree (Comment.parentId's onDelete: Cascade) -- mirrored here so
    // local state doesn't keep showing replies whose parent just
    // disappeared. Computed from the tree built from *current* comments,
    // not a stale snapshot.
    const deletedSubtree = new Set<number>();
    const tree = buildCommentTree(comments);
    const deletedNode = findNodeInTree(tree, commentId);
    if (deletedNode) collectSubtreeIds(deletedNode, deletedSubtree);
    else deletedSubtree.add(commentId);
    setComments((prev) => prev.filter((c) => !deletedSubtree.has(c.id)));
  }

  function findNodeInTree(nodes: CommentNode[], id: number): CommentNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = findNodeInTree(node.children, id);
      if (found) return found;
    }
    return null;
  }

  const commentsById = new Map(comments.map((c) => [c.id, c]));

  function renderCommentBody(comment: CommentDTO) {
    const isOwner = currentUser?.id === comment.author.id;
    const canDelete = isOwner || isAdmin;
    const isEditing = editingId === comment.id;
    // Phase 7: Comment.updatedAt is already a Prisma @updatedAt column
    // (see schema.prisma) that only ever moves off createdAt when the
    // content is actually edited -- reused directly as the "(수정됨)"
    // signal instead of adding a new editedAt column, unlike chat's
    // Message (which needed one because Message rows are also touched by
    // reactions/hiding, so its updatedAt-equivalent couldn't mean "edited"
    // on its own).
    const wasEdited = comment.updatedAt.getTime() !== comment.createdAt.getTime();
    // Phase H-3: the @닉네임 target -- only shown when this comment is a
    // reply AND its parent is still resolvable from current state (a
    // dangling parentId, e.g. after a local-state edge case, just omits
    // the tag rather than showing something wrong).
    const replyTargetNickname = comment.parentId !== null ? (commentsById.get(comment.parentId)?.author.nickname ?? null) : null;

    if (isEditing) {
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <AuthorLink
              nickname={comment.author.nickname}
              publicId={comment.author.publicId}
              className="font-medium text-foreground hover:underline"
            />
            <span className="text-xs text-muted-foreground">{formatRelativeTime(comment.createdAt)}</span>
          </div>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            maxLength={COMMENT_MAX_LENGTH}
            rows={2}
            autoFocus
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
      );
    }

    return (
      <div className="flex flex-col gap-2">
        {/* Phase 7: 수정/삭제/신고 now live in the same "⋯"-menu / mobile
            long-press pattern P-6 introduced for chat messages (see
            CommentActionMenu, modeled on chat/MessageActionMenu.tsx). 답글
            stays a separate, always-visible button below since it isn't an
            ownership-gated action. */}
        <CommentActionMenu
          commentId={comment.id}
          canEdit={isOwner}
          canDelete={canDelete}
          canReport={Boolean(currentUser) && !isOwner}
          onEdit={() => startEdit(comment)}
          onDelete={() => handleDelete(comment.id)}
        >
          <div className="flex items-center justify-between gap-2">
            {/* Phase H-7: same profile link every other author display uses --
                this is exactly the "닉네임 · 시간" shape this phase's spec gives
                as its own example. */}
            <AuthorLink
              nickname={comment.author.nickname}
              publicId={comment.author.publicId}
              className="font-medium text-foreground hover:underline"
            />
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(comment.createdAt)}
              {wasEdited ? " · (수정됨)" : ""}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-foreground">
            {replyTargetNickname && (
              <Link href={`#comment-${comment.parentId}`} className="mr-1 font-medium text-primary hover:underline">
                @{replyTargetNickname}
              </Link>
            )}
            {comment.content}
          </p>
        </CommentActionMenu>

        {currentUser && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {/* Phase H-3: reply toggle now available at every depth -- a
                reply can itself be replied to, unlike the old
                top-level-only restriction. */}
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
          </div>
        )}
      </div>
    );
  }

  function renderReplyForm(comment: CommentDTO) {
    if (replyingToId !== comment.id) return null;
    return (
      <form
        onSubmit={(e) => handleReplySubmit(e, comment.id)}
        className="flex flex-col gap-2 rounded-lg border border-border p-3"
      >
        {/* Phase H-3: explicit reply-target line while composing, not just
            after the fact on the posted reply -- answers "누구에게 답글하는지"
            at the moment of writing, not only in the result. */}
        <span className="text-xs text-muted-foreground">
          <span className="font-medium text-primary">@{comment.author.nickname ?? "알 수 없음"}</span>
          님에게 답글
        </span>
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
    );
  }

  // Phase H-3: recursive -- unlike the old fixed one-level grouping, depth
  // is unbounded, but visual indentation caps at MAX_VISUAL_INDENT_DEPTH
  // (see that constant's own comment) so a very deep thread stays inside
  // the viewport; the @닉네임 tag (renderCommentBody) is what keeps a
  // visually-flattened deep reply still traceable to its real parent.
  function renderCommentNode(node: CommentNode, depth: number) {
    const indentPx = Math.min(depth, MAX_VISUAL_INDENT_DEPTH) * INDENT_PX_PER_DEPTH;
    return (
      <div key={node.id} className="flex flex-col gap-2" style={depth > 0 ? { marginLeft: indentPx } : undefined}>
        {/* Phase E-4: id target for notification deep links
            (/post/{id}?type=...#comment-{id}) -- pure native browser
            anchor scroll, no JS added here. Preserved unchanged at every
            depth, not just top-level. */}
        <div
          id={`comment-${node.id}`}
          className={`flex flex-col gap-1 rounded-lg border p-3 text-sm ${
            depth > 0 ? "border-l-2 border-primary/30 bg-muted/30" : "border-border"
          }`}
        >
          {renderCommentBody(node)}
        </div>

        {renderReplyForm(node)}

        {node.children.length > 0 && (
          <div className="flex flex-col gap-2">
            {node.children.map((child) => renderCommentNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  const tree = buildCommentTree(comments);

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-6">
      <h2 className="flex items-center gap-1.5 font-semibold text-foreground">
        <ChatBubbleIcon className="size-4.5" />
        댓글 {comments.length}
      </h2>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {tree.length === 0 ? (
        <p className="text-sm text-muted-foreground">아직 댓글이 없어요. 첫 댓글을 남겨보세요.</p>
      ) : (
        <div className="flex flex-col gap-3">{tree.map((node) => renderCommentNode(node, 0))}</div>
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
