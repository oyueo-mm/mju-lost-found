"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { sendThankNoteAction } from "@/app/(main)/me/thanks/actions";
import { Button } from "@/components/ui/Button";
import { FallbackImage } from "@/components/ui/FallbackImage";
import { ImageOffIcon } from "@/components/icons";
import { useI18n } from "@/lib/i18n/client";
import { THANK_NOTE_MAX_LENGTH, THANK_NOTES_PER_DAY } from "@/lib/thanks/eligibility";
import type { SendThankError } from "@/lib/thanks/service";

// 감사 후기 남기기 (Phase 3-B): a small dialog opened from the chat room's
// 반환 완료 card (or the post page). It names the item and the receiver --
// both come from the recorded return, never chosen -- and holds only the
// message and 후기 보내기. One short line says the receiver may publish it
// without the sender's name (the sender should know before writing); no
// other notices. Sending is optional and never undoes the completion.
// The server re-checks who may thank whom on every send (lib/thanks).
export function ThankReviewDialog({
  postType,
  postId,
  receiverName,
  postTitle,
  postImageUrl,
  triggerLabel,
  triggerStyle = "button",
  onSent,
}: {
  postType: "lost" | "found";
  postId: number;
  receiverName: string | null;
  postTitle: string;
  postImageUrl: string | null;
  triggerLabel: string;
  // "link": a small text link (after 나중에 하기)
  triggerStyle?: "button" | "link";
  onSent?: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<SendThankError | null>(null);
  const [pending, startTransition] = useTransition();
  const canSend = body.trim().length > 0 && !pending;

  const errorText = (e: SendThankError) =>
    e === "empty" ? t("thanks.error.empty")
    : e === "too_long" ? t("thanks.error.tooLong", { max: THANK_NOTE_MAX_LENGTH })
    : e === "already_sent" ? t("thanks.error.already")
    : e === "daily_limit" ? t("thanks.error.daily", { max: THANK_NOTES_PER_DAY })
    : t("thanks.error.notEligible");

  const open = () => {
    const d = dialogRef.current;
    if (d && typeof d.showModal === "function") d.showModal();
  };
  const close = () => dialogRef.current?.close();

  return (
    <>
      {triggerStyle === "link" ? (
        <button type="button" onClick={open} className="min-h-9 rounded-md px-2 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary">
          {triggerLabel}
        </button>
      ) : (
        <Button type="button" size="sm" onClick={open}>
          {triggerLabel}
        </Button>
      )}
      <dialog
        ref={dialogRef}
        aria-labelledby={`${id}-title`}
        className="m-auto w-[min(26rem,calc(100vw-1.5rem))] rounded-card border border-border bg-card p-0 text-foreground shadow-lg backdrop:bg-black/40"
      >
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSend) return;
            setError(null);
            startTransition(async () => {
              try {
                const r = await sendThankNoteAction({ postType, postId, body });
                if (r.ok) {
                  close();
                  onSent?.();
                  router.refresh();
                } else setError(r.error); // the text stays as typed
              } catch {
                setError("not_eligible");
              }
            });
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id={`${id}-title`} className="text-base font-semibold">
              {t("thanks.review.title")}
            </h2>
            <button type="button" onClick={close} className="-mt-1 -mr-1 min-h-9 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
              {t("thanks.review.close")}
            </button>
          </div>

          <div className="flex items-center gap-3 rounded-lg bg-muted/70 p-2.5">
            <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
              {postImageUrl ? (
                <FallbackImage src={postImageUrl} alt="" fill sizes="44px" className="object-cover" fallback={<ImageOffIcon className="size-4" />} />
              ) : (
                <ImageOffIcon aria-hidden="true" className="size-4" />
              )}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{postTitle}</span>
              <span className="truncate text-xs text-muted-foreground">{t("thanks.review.to", { name: receiverName ?? t("thanks.unknownName") })}</span>
            </span>
          </div>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{t("thanks.review.messageLabel")}</span>
            <textarea
              rows={4}
              maxLength={THANK_NOTE_MAX_LENGTH}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("thanks.review.placeholder")}
              aria-describedby={`${id}-disclosure`}
              className="resize-y rounded-lg border border-border bg-card px-3 py-2.5 text-sm"
            />
            <span id={`${id}-disclosure`} className="text-xs leading-relaxed break-keep [overflow-wrap:anywhere] text-muted-foreground">
              {t("thanks.review.disclosure")}
            </span>
          </label>

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {errorText(error)}
            </p>
          )}
          <Button type="submit" disabled={!canSend} className="w-full">
            {pending ? t("thanks.review.sending") : t("thanks.review.send")}
          </Button>
        </form>
      </dialog>
    </>
  );
}
