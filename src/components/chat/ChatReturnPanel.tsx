"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { completeFromChatAction } from "@/app/(main)/me/thanks/actions";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/client";

// 찾음 완료 from the chat room (Phase 3-B layout): a small card for the
// post's author (canCompleteFromChat -- the server re-checks everything in
// completeFromChat and records this room's other person as the return
// partner). A short confirmation first; on success the page refreshes and
// the conversation shows the 반환 완료 card (ReturnCompletedCard), where the
// optional 감사 후기 is offered.
export function ChatReturnPanel({ chatRoomId, postType }: { chatRoomId: number; postType: "lost" | "found" }) {
  const { t } = useI18n();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ask = () => {
    const d = dialogRef.current;
    if (d && typeof d.showModal === "function") d.showModal();
    else if (window.confirm(`${t("chat.complete.title")}\n${t("chat.complete.body")}`)) confirm();
  };

  const confirm = () =>
    startTransition(async () => {
      setError(null);
      try {
        const r = await completeFromChatAction(chatRoomId);
        dialogRef.current?.close();
        if (r === "ok" || r === "already_completed") {
          if (r === "already_completed") setError(t("chat.complete.already"));
          router.refresh();
        } else setError(t("chat.complete.failed"));
      } catch {
        setError(t("chat.complete.failed"));
      }
    });

  return (
    <section aria-labelledby={`complete-prompt-${chatRoomId}`} className="flex shrink-0 flex-col gap-1.5 rounded-lg bg-muted/70 px-3.5 py-2.5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h2 id={`complete-prompt-${chatRoomId}`} className="font-semibold break-keep [overflow-wrap:anywhere] text-foreground">
            {t(postType === "lost" ? "chat.complete.prompt.lost.title" : "chat.complete.prompt.found.title")}
          </h2>
          <p className="text-xs break-keep [overflow-wrap:anywhere] text-muted-foreground">
            {t(postType === "lost" ? "chat.complete.prompt.lost.body" : "chat.complete.prompt.found.body")}
          </p>
        </div>
        <Button type="button" size="sm" onClick={ask} disabled={pending} className="shrink-0">
          {t("chat.complete.button")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <dialog
        ref={dialogRef}
        aria-labelledby={`complete-title-${chatRoomId}`}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            dialogRef.current?.close();
          }
        }}
        className="m-auto w-[min(22rem,calc(100vw-2rem))] rounded-card border border-border bg-card p-5 text-foreground shadow-lg backdrop:bg-black/40"
      >
        <h2 id={`complete-title-${chatRoomId}`} className="text-base font-semibold">
          {t("chat.complete.title")}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("chat.complete.body")}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => dialogRef.current?.close()} disabled={pending}>
            {t("chat.complete.cancel")}
          </Button>
          <Button type="button" size="sm" onClick={confirm} disabled={pending}>
            {pending ? t("common.loading") : t("chat.complete.confirm")}
          </Button>
        </div>
      </dialog>
    </section>
  );
}
