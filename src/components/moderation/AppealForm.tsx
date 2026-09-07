"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { submitAppealAction } from "@/app/(auth)/suspended/actions";
import { Button } from "@/components/ui/Button";

const MAX_LENGTH = 2000;

// Phase I section 4: minimal appeal flow -- write, submit, see the
// submitted state. No edit/withdraw once submitted (mirrors this phase's
// own "최소 기능" framing); a suspended user can always see their latest
// appeal's status on next visit via the page's own getLatestAppealForUser()
// read, not local component state, so this doesn't need to persist
// anything client-side either.
export function AppealForm() {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("content", content);
      const result = await submitAppealAction(null, formData);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSubmitted(true);
      router.refresh();
    });
  }

  if (submitted) {
    return (
      <p className="rounded-card border border-primary/30 bg-primary-muted px-4 py-3 text-sm text-primary">
        이의신청이 제출되었습니다. 운영자 검토를 기다려주세요.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">이의신청 내용</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          maxLength={MAX_LENGTH}
          required
          disabled={pending}
          placeholder="정지 사유에 이의가 있으신 경우, 구체적인 내용을 적어주세요."
          className="rounded-lg border border-border bg-transparent px-3 py-2.5 text-sm text-foreground disabled:opacity-60"
        />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="sm" disabled={pending || !content.trim()} className="self-start">
        {pending ? "제출 중..." : "이의신청 제출"}
      </Button>
    </form>
  );
}
