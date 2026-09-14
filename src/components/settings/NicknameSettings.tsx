"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateNicknameAction } from "@/app/(main)/me/actions";
import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from "@/lib/auth/nickname";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/client";
import { LOCALE_INTL_TAG, type Locale } from "@/lib/i18n/config";
import type { Translator } from "@/lib/i18n/translate";

type NicknameSettingsProps = {
  currentNickname: string;
  // Phase I section 7: the next instant a change is allowed, straight
  // from User.nicknameChangeAvailableAt -- null means never changed via
  // /me yet (always allowed), same meaning the DB column itself has.
  nicknameChangeAvailableAt: Date | null;
};

function formatDateTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(date);
}

// Phase I: pulled out to a plain top-level function (not inlined in the
// component body) for the same reason CommentSection's own
// formatRelativeTime and this file's formatRemaining below already are --
// eslint's react-hooks/purity rule flags a bare `Date.now()` call written
// directly in a component's render body, but not one reached through an
// ordinary function call it can't see through.
function isInFuture(date: Date): boolean {
  return date.getTime() > Date.now();
}

// Coarse remaining-time text, same bucket style CommentSection's own
// formatRelativeTime/the redesigned /suspended page's formatRemaining use.
function formatRemaining(until: Date, t: Translator): string {
  const diffMs = until.getTime() - Date.now();
  if (diffMs <= 0) return t("nickname.availableSoon");
  const hours = Math.ceil(diffMs / 3600000);
  if (hours < 24) return t("nickname.hoursRemaining", { count: hours });
  const days = Math.ceil(hours / 24);
  return t("nickname.daysRemaining", { count: days });
}

// Phase H-7: direct server-action call inside useTransition (not
// useActionState) so a successful change can collapse the form back to
// view mode and refresh the page in one synchronous branch, without a
// useEffect reacting to returned state -- this codebase's eslint config
// blocks setState-in-effect even for legitimate cases (see H-3's
// ThemeSettings/useSyncExternalStore workaround for that same rule), so
// this shape sidesteps it entirely rather than fighting it again.
export function NicknameSettings({ currentNickname, nicknameChangeAvailableAt }: NicknameSettingsProps) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentNickname);
  const [error, setError] = useState<string | null>(null);
  // Phase I: only ever set from the server action's own "onCooldown"
  // result (a race where the cooldown expired/changed between page load
  // and submit) -- the page-load value comes from the
  // nicknameChangeAvailableAt prop instead, read fresh on every render.
  const [cooldownOverride, setCooldownOverride] = useState<Date | null>(null);
  const [pending, startTransition] = useTransition();

  const effectiveCooldown = cooldownOverride ?? nicknameChangeAvailableAt;
  const onCooldown = effectiveCooldown !== null && isInFuture(effectiveCooldown);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("nickname", value);
      const result = await updateNicknameAction(null, formData);
      if ("onCooldown" in result) {
        setCooldownOverride(result.availableAt);
        setEditing(false);
        return;
      }
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
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("nickname.current", { name: currentNickname })}</span>
        {onCooldown ? (
          <p className="text-xs text-muted-foreground">
            {t("nickname.nextChange", { date: formatDateTime(effectiveCooldown!, locale), remaining: formatRemaining(effectiveCooldown!, t) })}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => {
              setValue(currentNickname);
              setError(null);
              setEditing(true);
            }}
            className="w-fit text-sm font-medium text-primary hover:opacity-80"
          >
            {t("nickname.change")}
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("nickname.new")}</span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("nickname.placeholder", { min: NICKNAME_MIN_LENGTH, max: NICKNAME_MAX_LENGTH })}
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
          {pending ? t("nickname.changing") : t("common.save")}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={pending}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
