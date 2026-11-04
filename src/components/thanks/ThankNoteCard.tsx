"use client";

import { useState, useTransition } from "react";

import { setThankNotePublishedAction } from "@/app/(main)/me/thanks/actions";
import { useI18n } from "@/lib/i18n/client";
import type { RoomThankNote } from "@/lib/thanks/service";
import { ThankTagList } from "./ThankTagList";

// A 감사 후기 in the chat room (Phase 3-B), placed in the conversation by its
// time. A system card, not a speech bubble.
// - sent: what the viewer wrote, and that it was sent. The sender is not told
//   whether the receiver published it.
// - received: the note, its 공개 상태 (기본 비공개) and the receiver's own
//   toggle -- 내 프로필에 공개 / 비공개로 변경. The server re-checks that the
//   viewer is the receiver and refuses to publish a note that looks like it
//   holds contact details (then the toggle is not offered).
export function ThankNoteCard({ note, time }: { note: RoomThankNote; time: string }) {
  const { t } = useI18n();
  const [published, setPublished] = useState(note.published);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const received = note.role === "received";

  const toggle = () => {
    const next = !published;
    if (next && !window.confirm(t("thanks.publishConfirm"))) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await setThankNotePublishedAction(note.id, next);
        if (r.ok) setPublished(next);
        else setError(r.reason === "personal" ? t("thanks.personalBlockedError") : t("thanks.changeFailed"));
      } catch {
        setError(t("thanks.changeFailed"));
      }
    });
  };

  return (
    <div className="my-2 flex justify-center" data-thank-note={note.role}>
      <section
        aria-label={received ? t("thanks.review.receivedTitle") : t("thanks.review.sentTitle")}
        className="flex w-full max-w-sm flex-col gap-2 rounded-card border border-border bg-card px-4 py-3 text-sm"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-primary">{received ? t("thanks.review.receivedTitle") : t("thanks.review.sentTitle")}</h3>
          <time className="shrink-0 text-xs text-muted-foreground">{time}</time>
        </div>
        <ThankTagList tags={note.tags} />
        {note.body && <p className="whitespace-pre-line [overflow-wrap:anywhere] text-foreground">{note.body}</p>}
        {received ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${published ? "bg-primary-muted text-primary" : "bg-muted text-muted-foreground"}`}
              aria-live="polite"
            >
              {published ? t("thanks.status.public") : t("thanks.status.private")}
            </span>
            {note.personal && !published ? (
              <span className="text-xs text-muted-foreground">{t("thanks.personalBlocked")}</span>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={toggle}
                aria-pressed={published}
                className="min-h-9 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-primary"
              >
                {published ? t("thanks.review.unpublish") : t("thanks.review.publish")}
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("thanks.review.sentDone")}</p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
