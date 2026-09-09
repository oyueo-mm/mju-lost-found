"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createFeedbackAction } from "@/app/(main)/feedback/actions";
import { FEEDBACK_CATEGORIES, FEEDBACK_CATEGORY_LABELS, type FeedbackCategoryValue } from "@/lib/feedback/schema";
import { Button } from "@/components/ui/Button";

const FIELD_CLASS =
  "rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-sm text-foreground disabled:opacity-60";

// Phase 11-5: same "direct Server Action call inside a plain async
// handler, not useActionState" convention CreateAnnouncementForm.tsx
// already established for this app's create-forms -- see that component's
// own comment.
export function FeedbackForm() {
  const router = useRouter();
  const [category, setCategory] = useState<FeedbackCategoryValue>(FEEDBACK_CATEGORIES[0]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const result = await createFeedbackAction({ category, title, content });
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">서비스 개선 제안</h2>
      <p className="text-xs text-muted-foreground">
        불편한 점, 있었으면 하는 기능, 버그, 기타 의견을 자유롭게 남겨주세요.
      </p>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">유형</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="의견 유형 선택">
          {FEEDBACK_CATEGORIES.map((c) => (
            <Button
              key={c}
              type="button"
              variant={category === c ? "primary" : "secondary"}
              size="sm"
              aria-pressed={category === c}
              disabled={pending}
              onClick={() => setCategory(c)}
              className="h-8 px-3 text-xs"
            >
              {FEEDBACK_CATEGORY_LABELS[c]}
            </Button>
          ))}
        </div>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">제목</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          disabled={pending}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">내용</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={5000}
          rows={5}
          required
          disabled={pending}
          className={FIELD_CLASS}
        />
      </label>

      {error && (
        <p className="rounded-card border border-destructive/30 bg-destructive-muted px-3.5 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" size="sm" disabled={pending || !title.trim() || !content.trim()} className="self-start">
        {pending ? "제출 중..." : "의견 보내기"}
      </Button>
    </form>
  );
}
