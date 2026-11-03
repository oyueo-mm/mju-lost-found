"use client";

import { useState, useSyncExternalStore, useTransition } from "react";

import { sendThankNoteAction } from "@/app/(main)/me/thanks/actions";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/client";
import { THANK_NOTE_MAX_LENGTH, THANK_NOTES_PER_DAY } from "@/lib/thanks/eligibility";
import type { SendThankError } from "@/lib/thanks/service";

// 감사 쪽지 쓰기. Optional: the post is done whether or not a note is written.
// The receiver is the recorded return partner (shown, never chosen).
//   variant "details" -- the post page: one collapsed line until opened
//   variant "prompt"  -- the chat room right after 찾음 완료: a small card with
//                        감사 쪽지 보내기 / 나중에; 나중에 folds it into one line
//                        (remembered per return on this device), still usable
const subscribeStorage = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

export function ThankNoteComposer({
  postType,
  postId,
  receiverName,
  alreadySent,
  returnId,
  variant = "details",
}: {
  postType: "lost" | "found";
  postId: number;
  receiverName: string | null;
  alreadySent: boolean;
  returnId: number | null;
  variant?: "details" | "prompt";
}) {
  const { t } = useI18n();
  const laterKey = `mju-find:thanks-later:${returnId ?? `${postType}-${postId}`}`;
  const [body, setBody] = useState("");
  const [error, setError] = useState<SendThankError | null>(null);
  const [sent, setSent] = useState(alreadySent);
  const [open, setOpen] = useState(false);
  // 나중에, remembered on this device (read after hydration; false on the server)
  const [laterNow, setLater] = useState(false);
  const laterStored = useSyncExternalStore(subscribeStorage, () => window.localStorage.getItem(laterKey) === "1", () => false);
  const later = laterNow || (variant === "prompt" && laterStored);
  const [pending, startTransition] = useTransition();
  const name = receiverName ?? t("thanks.unknownName");

  if (sent) {
    return (
      <p role="status" className="rounded-card border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        {t("thanks.sent")}
      </p>
    );
  }

  const errorText = (e: SendThankError) =>
    e === "empty" ? t("thanks.error.empty")
    : e === "too_long" ? t("thanks.error.tooLong", { max: THANK_NOTE_MAX_LENGTH })
    : e === "already_sent" ? t("thanks.error.already")
    : e === "daily_limit" ? t("thanks.error.daily", { max: THANK_NOTES_PER_DAY })
    : t("thanks.error.notEligible");

  const form = (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          try {
            const r = await sendThankNoteAction({ postType, postId, body });
            if (r.ok) setSent(true);
            else setError(r.error);
          } catch {
            setError("not_eligible");
          }
        });
      }}
    >
      <p className="text-muted-foreground">{t("thanks.receiver", { name })}</p>
      <label className="flex flex-col gap-1.5">
        <span>{t("thanks.bodyLabel")}</span>
        <textarea
          required
          rows={4}
          maxLength={THANK_NOTE_MAX_LENGTH}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-describedby={`thank-hint-${postId}`}
          className="rounded-lg border border-border bg-transparent px-3 py-2.5"
          placeholder={t("thanks.placeholder")}
        />
      </label>
      <p id={`thank-hint-${postId}`} className="text-xs text-muted-foreground">
        {t("thanks.hint")}
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {errorText(error)}
        </p>
      )}
      <Button type="submit" size="sm" disabled={pending || !body.trim()} className="self-start">
        {pending ? t("thanks.sending") : t("thanks.send")}
      </Button>
    </form>
  );

  if (variant === "prompt") {
    if (later && !open) {
      return (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-11 w-full items-center justify-between rounded-card border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {t("thanks.composer.open")} <span className="text-xs font-normal text-muted-foreground">{t("thanks.optional")}</span>
        </button>
      );
    }
    return (
      <section aria-labelledby={`thank-prompt-${postId}`} className="flex flex-col gap-3 rounded-card border border-primary/30 bg-primary-muted/60 px-4 py-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <h2 id={`thank-prompt-${postId}`} className="font-semibold text-foreground">
            {t("thanks.prompt.title")}
          </h2>
          <p className="text-muted-foreground">{t("thanks.prompt.body")}</p>
        </div>
        {open ? (
          form
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => setOpen(true)}>
              {t("thanks.send")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                window.localStorage.setItem(laterKey, "1");
                setLater(true);
              }}
            >
              {t("thanks.prompt.later")}
            </Button>
          </div>
        )}
      </section>
    );
  }

  return (
    <details className="group rounded-card border border-border bg-card text-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-card px-4 py-3 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        {t("thanks.composer.open")} <span className="text-xs font-normal text-muted-foreground">{t("thanks.optional")}</span>
      </summary>
      <div className="border-t border-border px-4 py-3">{form}</div>
    </details>
  );
}
