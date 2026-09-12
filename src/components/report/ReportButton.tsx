"use client";

import { useState } from "react";

import { REPORT_REASONS, type ReportTargetType } from "@/lib/report/schema";
import { useI18n } from "@/lib/i18n/client";

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
  // Phase D-2: fires once the report is actually accepted (201), after
  // the "접수되었습니다" message is already showing -- MessageActionMenu
  // uses this to close the whole popover instead of leaving it open on
  // the success caption. Unused (and harmless) everywhere else.
  onSuccess?: () => void;
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
// then shows a static "접수되었습니다" caption. All real validation (target
// exists, no self-report, no duplicate) happens server-side in
// createReport() -- this component is presentation only, exactly like its
// legacy counterpart, so there's no separate client-side security surface
// to keep in sync. Rendered unconditionally wherever the legacy button
// was (e.g. every post detail page, regardless of who owns it) --
// self-reports are rejected at submit time with a normal error message,
// not hidden from the UI ahead of time, matching legacy exactly.
export function ReportButton({
  targetType,
  targetId,
  buttonLabel,
  autoOpen = false,
  onSuccess,
  triggerClassName,
}: ReportButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(autoOpen);
  const [done, setDone] = useState(false);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (done) {
    return <p className="text-sm text-success">{t("report.submitted")}</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={triggerClassName ?? "text-sm text-muted-foreground underline hover:text-foreground"}
      >
        {/* 다국어(i18n) Phase: 호출자가 라벨을 넘기지 않으면 기본
            "신고하기"를 현재 언어로 보여준다 -- 예전 기본값의 의미
            그대로다(게시글 상세/프로필은 여전히 짧은 "신고"를 직접
            넘긴다). */}
        {buttonLabel ?? t("report.button")}
      </button>
    );
  }

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
      onSuccess?.();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-sm"
    >
      {error && <p className="text-destructive">{error}</p>}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("report.reason")}</span>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="rounded-lg border border-border bg-transparent px-2 py-1 text-foreground"
        >
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("report.detail")}</span>
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={2}
          className="rounded-lg border border-border bg-transparent px-2 py-1 text-foreground"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-60"
        >
          {submitting ? t("report.submitting") : t("report.submit")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={submitting}
          className="rounded-full border border-border px-3 py-1 text-xs text-foreground disabled:opacity-60"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
