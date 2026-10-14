"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { REPORT_REASONS, type ReportTargetType } from "@/lib/report/schema";
import { useI18n } from "@/lib/i18n/client";
import { reportReasonLabelKey } from "@/lib/i18n/labels";

type ReportButtonProps = {
  targetType: ReportTargetType;
  targetId: number;
  buttonLabel?: string;
  // Phase D-2: lets a caller that already has its own trigger (e.g. an
  // "신고" item inside MessageActionMenu's dropdown) skip this
  // component's own toggle button and land straight on the reason/detail
  // form -- everywhere else (post/comment) omits this and keeps the
  // original two-step "신고하기" link -> form behavior unchanged.
  autoOpen?: boolean;
  // Phase D-2: fires once the report has been accepted (201) and the
  // "접수되었습니다" message in the dialog is dismissed -- the comment/
  // message menus use this to close themselves. Unused (and harmless)
  // everywhere else.
  onSuccess?: () => void;
  // Fires when the dialog is dismissed without a report (취소, 닫기, Escape,
  // backdrop). The comment/message menus use it to close themselves too.
  onClose?: () => void;
  // Phase I section 8: lets one caller (post/[id]/page.tsx) restyle just
  // the closed-state trigger button -- e.g. into a small pill sitting next
  // to PostManageMenu's own "⋯" trigger instead of this component's
  // default underlined-text link -- without touching the other three call
  // sites (chat header, CommentSection, MessageActionMenu), which all omit
  // this and keep their exact existing look.
  triggerClassName?: string;
};

// Client-side port of legacy ui/common.py::render_report_control(): a
// button that opens a reason/detail form, submits to POST /api/reports,
// then shows a "접수되었습니다" message. All real validation (target
// exists, no self-report, no duplicate) happens server-side in
// createReport() -- this component is presentation only, exactly like its
// legacy counterpart, so there's no separate client-side security surface
// to keep in sync. Rendered unconditionally wherever the legacy button
// was (e.g. every post detail page, regardless of who owns it) --
// self-reports are rejected at submit time with a normal error message,
// not hidden from the UI ahead of time, matching legacy exactly.
//
// 모바일 신고창 Phase: the form used to render inline, right where the
// trigger sits -- next to a post title, in a profile or chat header, or
// inside a comment/message menu. Its fields have an intrinsic width of
// about 320px, so in a narrow flex row it ran past the screen edge and
// squeezed the title beside it down to one character per line. It now
// opens as a dialog portaled to <body> and positioned against the
// viewport, so it always fits the screen and takes no part in the layout
// of the page behind it. The "접수되었습니다" message is shown inside the
// dialog too -- swapped in for the trigger, it squeezed the title the same
// way -- and the trigger is gone once the dialog closes.
export function ReportButton({
  targetType,
  targetId,
  buttonLabel,
  autoOpen = false,
  onSuccess,
  onClose,
  triggerClassName,
}: ReportButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(autoOpen);
  const [done, setDone] = useState(false);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  function close() {
    if (submitting) return;
    setOpen(false);
    setError(null);
    if (done) {
      onSuccess?.();
    } else {
      triggerRef.current?.focus();
      onClose?.();
    }
  }
  // The effect below registers once per opening and reads the latest
  // close() (which depends on `submitting` and `done`) through this ref.
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  // While the dialog is open: focus starts on the first field, Escape
  // closes it, Tab stays inside it, and the page behind does not scroll.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("select")?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("select, textarea, button:not([disabled])")];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  // After a report is accepted, focus moves to the message's 닫기 button.
  useEffect(() => {
    if (done) dialogRef.current?.querySelector<HTMLElement>("[data-report-done] button")?.focus();
  }, [done]);

  if (done && !open) return null;

  // autoOpen callers (the comment/message menus) have their own "신고"
  // item, so they never show this trigger.
  const trigger = autoOpen ? null : (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={triggerClassName ?? "text-sm text-muted-foreground underline hover:text-foreground"}
    >
      {/* 다국어(i18n) Phase: 호출자가 라벨을 넘기지 않으면 기본
          "신고하기"를 현재 언어로 보여준다 -- 예전 기본값의 의미
          그대로다(게시글 상세/프로필은 여전히 짧은 "신고"를 직접
          넘긴다). */}
      {buttonLabel ?? t("report.button")}
    </button>
  );

  if (!open || typeof document === "undefined") return trigger;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, reason, detail: detail || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? t("report.failed"));
        return;
      }
      setDone(true);
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  const dialog = (
    // data-report-dialog: the comment/message menus close on a pointer
    // press outside themselves; this marks the (portaled) dialog as part
    // of them.
    <div
      data-report-dialog
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-full w-full max-w-sm flex-col gap-3 overflow-y-auto rounded-card border border-border bg-card p-4 shadow-lg"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-sm font-semibold text-foreground">
            {t("report.button")}
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={submitting}
            aria-label={t("common.close")}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        </div>
        {done ? (
          <div data-report-done className="flex flex-col gap-3 text-sm">
            <p role="status" className="text-success">
              {t("report.submitted")}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={close}
                className="rounded-full border border-border px-3 py-1.5 text-xs text-foreground"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-2 text-sm">
            {error && <p className="text-destructive">{error}</p>}
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("report.reason")}</span>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-border bg-transparent px-2 py-1.5 text-foreground"
              >
                {REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {reportReasonLabelKey(r) ? t(reportReasonLabelKey(r)!) : r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("report.detail")}</span>
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={3}
                className="w-full min-w-0 rounded-lg border border-border bg-transparent px-2 py-1.5 text-foreground"
              />
            </label>
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
              >
                {submitting ? t("report.submitting") : t("report.submit")}
              </button>
              <button
                type="button"
                onClick={close}
                disabled={submitting}
                className="rounded-full border border-border px-3 py-1.5 text-xs text-foreground disabled:opacity-60"
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  return (
    <>
      {trigger}
      {createPortal(dialog, document.body)}
    </>
  );
}
