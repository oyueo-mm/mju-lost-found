"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { deleteAnnouncementAction, updateAnnouncementAction } from "@/app/(main)/admin/announcements/actions";
import { Button } from "@/components/ui/Button";

type AnnouncementRowProps = {
  id: number;
  title: string;
  content: string;
  createdAtLabel: string;
  updatedAtLabel: string;
  wasEdited: boolean;
  authorNickname: string | null;
};

// Same "toggle between display and edit form in one component" shape as
// settings/NicknameSettings.tsx -- editing an announcement is a small,
// single-field-pair change, not worth a separate /admin/announcements/[id]
// /edit route.
export function AnnouncementRow({
  id,
  title,
  content,
  createdAtLabel,
  updatedAtLabel,
  wasEdited,
  authorNickname,
}: AnnouncementRowProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(title);
  const [editContent, setEditContent] = useState(content);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const result = await updateAnnouncementAction(id, { title: editTitle, content: editContent });
    if ("error" in result) {
      setError(result.error);
      setPending(false);
      return;
    }

    setEditing(false);
    setPending(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm(`'${title}' 공지사항을 삭제하시겠습니까? 이미 발송된 알림은 그대로 남지만, 알림에서 이 공지로 이동할 수는 없게 됩니다.`)) {
      return;
    }
    setPending(true);
    setError(null);

    const result = await deleteAnnouncementAction(id);
    if ("error" in result) {
      setError(result.error);
      setPending(false);
      return;
    }
    router.refresh();
  }

  if (editing) {
    return (
      <form onSubmit={handleSave} className="flex flex-col gap-3 border-b border-border p-4 last:border-b-0">
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          maxLength={200}
          required
          disabled={pending}
          className="rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-sm text-foreground disabled:opacity-60"
        />
        <textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          maxLength={5000}
          rows={4}
          required
          disabled={pending}
          className="rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-sm text-foreground disabled:opacity-60"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={pending || !editTitle.trim() || !editContent.trim()}>
            {pending ? "저장 중..." : "저장"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => {
              setEditTitle(title);
              setEditContent(content);
              setError(null);
              setEditing(false);
            }}
          >
            취소
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border p-4 text-sm last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">
            {createdAtLabel}
            {wasEdited && ` · 수정됨: ${updatedAtLabel}`}
            {authorNickname && ` · 작성자: ${authorNickname}`}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={pending}
            className="rounded-full border border-border px-3 py-1 text-xs hover:border-foreground/30 disabled:opacity-60"
          >
            수정
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="rounded-full border border-destructive/40 px-3 py-1 text-xs text-destructive hover:bg-destructive-muted disabled:opacity-60"
          >
            {pending ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
      <p className="whitespace-pre-wrap text-muted-foreground">{content}</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
