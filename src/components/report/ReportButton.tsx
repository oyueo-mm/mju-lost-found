"use client";

import { useState } from "react";

import { REPORT_REASONS, type ReportTargetType } from "@/lib/report/schema";

type ReportButtonProps = {
  targetType: ReportTargetType;
  targetId: number;
  buttonLabel?: string;
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
export function ReportButton({ targetType, targetId, buttonLabel = "🚩 신고하기" }: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (done) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">✅ 신고가 접수되었습니다.</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        {buttonLabel}
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
        setError(json.error ?? "신고를 접수하지 못했습니다.");
        return;
      }
      setDone(true);
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-700"
    >
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">신고 사유</span>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
        >
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">상세 내용 (선택)</span>
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={2}
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {submitting ? "제출 중..." : "신고 제출"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={submitting}
          className="rounded-full border border-zinc-300 px-3 py-1 text-xs disabled:opacity-60 dark:border-zinc-700"
        >
          취소
        </button>
      </div>
    </form>
  );
}
