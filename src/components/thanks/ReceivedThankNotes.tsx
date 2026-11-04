"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { hideThankNoteAction, setThankNotePublishedAction } from "@/app/(main)/me/thanks/actions";
import { ReportButton } from "@/components/report/ReportButton";
import { useI18n } from "@/lib/i18n/client";
import type { ReceivedThankNote } from "@/lib/thanks/service";
import { ThankTagList } from "./ThankTagList";

// 받은 감사 쪽지: private by default. Publishing asks once more, since a
// published note can be read by anyone on the profile (without its sender).
// 숨기기 is not a delete: the note stays on record and never comes back here.
export function ReceivedThankNotes({ notes, dateLabels }: { notes: ReceivedThankNote[]; dateLabels: Record<number, string> }) {
  const { t } = useI18n();
  const [items, setItems] = useState(notes);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return <p className="rounded-card border border-border bg-card p-5 text-sm text-muted-foreground">{t("thanks.page.empty")}</p>;

  const publish = (n: ReceivedThankNote, published: boolean) => {
    if (published && !window.confirm(t("thanks.publishConfirm"))) return;
    startTransition(async () => {
      const r = await setThankNotePublishedAction(n.id, published);
      if (r.ok) setItems((all) => all.map((x) => (x.id === n.id ? { ...x, published } : x)));
      else setError(r.reason === "personal" ? t("thanks.personalBlockedError") : t("thanks.changeFailed"));
    });
  };
  const hide = (n: ReceivedThankNote) => {
    if (!window.confirm(t("thanks.hideConfirm"))) return;
    startTransition(async () => {
      const r = await hideThankNoteAction(n.id);
      if (r.ok) setItems((all) => all.filter((x) => x.id !== n.id));
      else setError(t("thanks.hideFailed"));
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {items.map((n) => (
          <li key={n.id} className="flex flex-col gap-2 rounded-card border border-border bg-card p-4 text-sm">
            <ThankTagList tags={n.tags} />
            {n.body && <p className="break-words whitespace-pre-line text-foreground">{n.body}</p>}
            <p className="text-xs text-muted-foreground">
              {n.senderNickname ?? t("thanks.unknownName")} · {dateLabels[n.id]} ·{" "}
              <Link href={`/post/${n.postId}?type=${n.postType}`} className="underline-offset-2 hover:underline">
                {n.postTitle ?? t("thanks.relatedPost")}
              </Link>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${n.published ? "bg-primary-muted text-primary" : "bg-muted text-muted-foreground"}`}>
                {n.published ? t("thanks.status.public") : t("thanks.status.private")}
              </span>
              {n.personal && !n.published ? (
                <span className="text-xs text-muted-foreground">{t("thanks.personalBlocked")}</span>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => publish(n, !n.published)}
                  className="min-h-9 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
                >
                  {n.published ? t("thanks.unpublish") : t("thanks.publish")}
                </button>
              )}
              <button type="button" disabled={pending} onClick={() => hide(n)} className="min-h-9 rounded-lg px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60">
                {t("thanks.hide")}
              </button>
              <ReportButton
                targetType="thank_note"
                targetId={n.id}
                buttonLabel={t("thanks.report")}
                triggerClassName="min-h-9 rounded-lg px-3 text-xs text-muted-foreground hover:text-foreground"
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
