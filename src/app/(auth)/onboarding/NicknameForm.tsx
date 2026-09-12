"use client";

import { useActionState } from "react";

import { setNicknameAction } from "./actions";
import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from "@/lib/auth/nickname";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/client";

export function NicknameForm() {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(setNicknameAction, null);

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("auth.onboarding.nickname")}</span>
        <input
          type="text"
          name="nickname"
          placeholder={t("auth.onboarding.placeholder", {
            min: NICKNAME_MIN_LENGTH,
            max: NICKNAME_MAX_LENGTH,
          })}
          maxLength={NICKNAME_MAX_LENGTH}
          required
          disabled={pending}
          className="rounded-card border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-60"
        />
      </label>
      {state?.error && (
        <p className="rounded-card border border-destructive/30 bg-destructive-muted px-3.5 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? t("auth.onboarding.submitting") : t("auth.onboarding.submit")}
      </Button>
    </form>
  );
}
