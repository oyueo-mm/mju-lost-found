"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createAnnouncementAction } from "@/app/(main)/admin/announcements/actions";
import { Button } from "@/components/ui/Button";

// Direct Server Action call inside a plain async handler (not
// useActionState) -- same convention NicknameSettings/reviewAppealAction
// already establish for this app's admin/settings forms: simpler than
// wiring a <form action={...}> + useActionState just to get a typed
// result back.
export function CreateAnnouncementForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const result = await createAnnouncementAction({ title, content });
    if ("error" in result) {
      setError(result.error);
      setPending(false);
      return;
    }

    setTitle("");
    setContent("");
    setPending(false);
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-card border border-border bg-card p-4"
    >
      <h2 className="text-sm font-semibold text-foreground">새 공지사항 작성</h2>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">제목</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          disabled={pending}
          className="rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-sm text-foreground disabled:opacity-60"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">내용</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={5000}
          rows={4}
          required
          disabled={pending}
          className="rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-sm text-foreground disabled:opacity-60"
        />
      </label>

      {error && (
        <p className="rounded-card border border-destructive/30 bg-destructive-muted px-3.5 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" size="sm" disabled={pending || !title.trim() || !content.trim()} className="self-start">
        {pending ? "등록 중..." : "공지 등록"}
      </Button>
    </form>
  );
}
