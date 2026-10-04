"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { submitRejoinAction } from "@/app/(auth)/rejoin/actions";
import { Button } from "@/components/ui/Button";

const MAX_LENGTH = 1000;

export function RejoinForm() {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await submitRejoinAction(reason);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">재가입 요청 사유</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={5}
          maxLength={MAX_LENGTH}
          required
          disabled={pending}
          placeholder="다시 이용하려는 이유를 적어주세요. (10자 이상)"
          className="rounded-lg border border-border bg-transparent px-3 py-2.5 text-sm text-foreground disabled:opacity-60"
        />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="sm" disabled={pending || reason.trim().length === 0} className="self-start">
        {pending ? "제출 중..." : "재가입 요청 보내기"}
      </Button>
    </form>
  );
}
