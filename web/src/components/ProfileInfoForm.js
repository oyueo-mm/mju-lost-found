"use client";

import { useActionState, useState } from "react";
import { updateStudentId } from "@/lib/profile-actions";

export default function ProfileInfoForm({ studentId }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(updateStudentId, null);

  if (state?.ok) {
    return <p className="mt-2 text-sm text-ink-faint">저장됐어요.</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-sm font-semibold text-brand-strong"
      >
        학번 {studentId ? "수정" : "입력하기"}
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-3 space-y-2">
      <input
        name="student_id"
        defaultValue={studentId || ""}
        inputMode="numeric"
        placeholder="학번 (숫자)"
        maxLength={12}
        autoComplete="off"
        required
        className="field !py-2 text-sm"
      />
      {state?.error && <p className="text-xs text-brand-deep">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary px-4 py-1.5 text-sm"
        >
          저장
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn btn-ghost px-4 py-1.5 text-sm"
        >
          취소
        </button>
      </div>
    </form>
  );
}
