"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { completeFromChatAction } from "@/app/(main)/me/thanks/actions";
import { Button } from "@/components/ui/Button";
import { ThankNoteComposer } from "@/components/thanks/ThankNoteComposer";
import { useI18n } from "@/lib/i18n/client";

// 채팅방 찾음 완료 + 감사 쪽지 안내, under the room's post chip.
//   canComplete -- the viewer is the post's author and it is not done yet:
//     one button, one short confirm; the room's other person becomes the
//     return partner on the server (no one is asked to pick anybody).
//   thank -- the viewer got the item back through this room's return and
//     has not thanked yet: the 감사의 마음을 전해보세요 card.
// The server re-checks both; these props only decide what is shown.
export function ChatReturnPanel({
  chatRoomId,
  canComplete,
  completed,
  thank,
}: {
  chatRoomId: number;
  canComplete: boolean;
  completed: boolean;
  thank: { postType: "lost" | "found"; postId: number; receiverName: string | null; alreadySent: boolean; returnId: number | null } | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canComplete && !thank && !completed) return null;

  // <dialog> needs iOS Safari 15.4+; older browsers get the native confirm box
  const ask = () => {
    const d = dialogRef.current;
    if (d && typeof d.showModal === "function") d.showModal();
    else if (window.confirm(`${t("chat.complete.title")}
${t("chat.complete.body")}`)) confirm();
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
    <div className="flex flex-col gap-2">
      {canComplete && (
        <>
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={ask} disabled={pending}>
              {t("chat.complete.button")}
            </Button>
          </div>
          <dialog
            ref={dialogRef}
            aria-labelledby={`complete-title-${chatRoomId}`}
            onKeyDown={(e) => {
              // Esc closes it in every browser (some builds skip the native cancel)
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
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {thank && (
        <ThankNoteComposer
          variant="prompt"
          postType={thank.postType}
          postId={thank.postId}
          receiverName={thank.receiverName}
          alreadySent={thank.alreadySent}
          returnId={thank.returnId}
        />
      )}
    </div>
  );
}
