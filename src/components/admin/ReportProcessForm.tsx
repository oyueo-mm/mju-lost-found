"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { MODERATION_ACTION_TYPE_LABELS, TARGET_TYPE_TO_ACTION_TYPE } from "@/lib/moderation/schema";
import type { ReportTargetType } from "@/lib/report/schema";

type ReportProcessFormProps = {
  reportId: number;
  targetType: ReportTargetType;
  targetDeleted: boolean;
};

// Client-side port of legacy pages/7_관리자.py::_render_process_control():
// pick a decision (반려/조치 완료), fill in the one action_type the target
// type implies (never a free choice -- see TARGET_TYPE_TO_ACTION_TYPE),
// then a confirm/cancel step before the irreversible POST. All real
// validation (pending only, one ModerationAction per report, action_type
// vs target_type match) happens server-side in dismissReport()/
// applyReportAction() -- this is presentation only.
export function ReportProcessForm({ reportId, targetType, targetDeleted }: ReportProcessFormProps) {
  const router = useRouter();
  const actionType = TARGET_TYPE_TO_ACTION_TYPE[targetType];

  const [decision, setDecision] = useState<"dismiss" | "action">("dismiss");
  const [adminNote, setAdminNote] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [suspendChoice, setSuspendChoice] = useState<"7" | "30" | "permanent">("7");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const body =
        decision === "dismiss"
          ? { decision: "dismiss" as const, adminNote: adminNote || undefined }
          : {
              decision: "action" as const,
              actionReason: actionReason || undefined,
              adminNote: adminNote || undefined,
              suspendDurationDays:
                actionType === "suspend_user" && suspendChoice !== "permanent"
                  ? Number(suspendChoice)
                  : undefined,
            };

      const res = await fetch(`/api/admin/reports/${reportId}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "처리하지 못했습니다.");
        setConfirming(false);
        return;
      }
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (confirming) {
    const confirmDesc = decision === "dismiss" ? "반려" : `조치 완료 (${MODERATION_ACTION_TYPE_LABELS[actionType]})`;
    return (
      <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
        <p className="text-amber-800 dark:text-amber-200">
          정말 이 신고에 대해 &apos;{confirmDesc}&apos; 처리를 적용하시겠습니까? 처리 후에는 되돌릴 수 없습니다.
        </p>
        {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {submitting ? "처리 중..." : "확인"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={submitting}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs disabled:opacity-60 dark:border-zinc-700"
          >
            취소
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-700">
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}

      {targetDeleted && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          대상이 이미 삭제되어 &apos;반려&apos;만 선택할 수 있습니다.
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">처리 상태 선택</span>
        <select
          value={decision}
          onChange={(e) => setDecision(e.target.value as "dismiss" | "action")}
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
        >
          <option value="dismiss">반려</option>
          <option value="action" disabled={targetDeleted}>
            조치 완료
          </option>
        </select>
      </label>

      {decision === "action" && (
        <>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            조치: {MODERATION_ACTION_TYPE_LABELS[actionType]}
          </p>
          {actionType === "suspend_user" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">정지 기간</span>
              <div className="flex gap-3">
                {(["7", "30", "permanent"] as const).map((v) => (
                  <label key={v} className="flex items-center gap-1 text-xs">
                    <input
                      type="radio"
                      name={`suspend-duration-${reportId}`}
                      checked={suspendChoice === v}
                      onChange={() => setSuspendChoice(v)}
                    />
                    {v === "7" ? "7일" : v === "30" ? "30일" : "영구"}
                  </label>
                ))}
              </div>
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">제재 사유 (선택)</span>
            <input
              type="text"
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
            />
          </label>
        </>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">관리자 메모 (선택)</span>
        <textarea
          value={adminNote}
          onChange={(e) => setAdminNote(e.target.value)}
          rows={2}
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
        />
      </label>

      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="self-start rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
      >
        처리하기
      </button>
    </div>
  );
}
