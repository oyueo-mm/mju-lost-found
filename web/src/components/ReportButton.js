"use client";

import { useActionState, useState } from "react";
import { submitReport } from "@/lib/report-actions";
import { REPORT_REASONS } from "@/lib/constants";

export default function ReportButton({ targetType, targetId }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    submitReport.bind(null, targetType, targetId),
    null,
  );

  if (state?.ok) {
    return (
      <p className="text-xs text-ink-faint">신고가 접수됐어요. 감사합니다.</p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn px-3 py-2 text-xs text-ink-faint hover:text-brand-deep"
      >
        신고
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="card-outline mt-1 w-full space-y-2 p-3.5"
    >
      <select name="reason" required defaultValue="" className="field !py-2 text-sm">
        <option value="" disabled>
          신고 사유 선택
        </option>
        {REPORT_REASONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <textarea
        name="detail"
        rows={2}
        maxLength={500}
        placeholder="상세 내용 (선택)"
        className="field !py-2 text-sm"
      />
      {state?.error && (
        <p className="text-xs text-brand-deep">{state.error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary px-3.5 py-1.5 text-xs"
        >
          신고 제출
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn btn-ghost px-3.5 py-1.5 text-xs"
        >
          취소
        </button>
      </div>
    </form>
  );
}
