"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateNicknameAction } from "@/app/(main)/me/actions";
import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from "@/lib/auth/nickname";
import { Button } from "@/components/ui/Button";

type NicknameSettingsProps = { currentNickname: string };

// Phase H-7: direct server-action call inside useTransition (not
// useActionState) so a successful change can collapse the form back to
// view mode and refresh the page in one synchronous branch, without a
// useEffect reacting to returned state -- this codebase's eslint config
// blocks setState-in-effect even for legitimate cases (see H-3's
// ThemeSettings/useSyncExternalStore workaround for that same rule), so
// this shape sidesteps it entirely rather than fighting it again.
export function NicknameSettings({ currentNickname }: NicknameSettingsProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentNickname);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("nickname", value);
      const result = await updateNicknameAction(null, formData);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(currentNickname);
          setError(null);
          setEditing(true);
        }}
        className="w-fit text-sm font-medium text-primary hover:opacity-80"
      >
        닉네임 변경
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">새 닉네임</span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`한글/영문/숫자 ${NICKNAME_MIN_LENGTH}~${NICKNAME_MAX_LENGTH}자`}
          maxLength={NICKNAME_MAX_LENGTH}
          required
          disabled={pending}
          className="rounded-card border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-60"
        />
      </label>
      {error && (
        <p className="rounded-card border border-destructive/30 bg-destructive-muted px-3.5 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !value.trim()}>
          {pending ? "변경 중..." : "저장"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={pending}>
          취소
        </Button>
      </div>
    </form>
  );
}
