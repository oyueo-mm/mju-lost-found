"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { MODERATION_ACTION_TYPE_LABELS, TARGET_TYPE_TO_ACTION_TYPE } from "@/lib/moderation/schema";
import type { ReportTargetType } from "@/lib/report/schema";
import { Button } from "@/components/ui/Button";
import { AlertIcon } from "@/components/icons";

const FIELD_CLASS = "rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground";

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
    const destructive = decision === "action";
    return (
      <div
        className={`flex flex-col gap-3 rounded-card border p-4 text-sm ${
          destructive ? "border-destructive/30 bg-destructive-muted" : "border-warning/30 bg-warning-muted"
        }`}
      >
        <p className={`flex items-start gap-1.5 ${destructive ? "text-destructive" : "text-warning"}`}>
          <AlertIcon className="mt-0.5 size-4 shrink-0" />
          정말 이 신고에 대해 &apos;{confirmDesc}&apos; 처리를 적용하시겠습니까? 처리 후에는 되돌릴 수 없습니다.
        </p>
        {error && <p className="text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button
            type="button"
            variant={destructive ? "destructive" : "primary"}
            size="sm"
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting ? "처리 중..." : "확인"}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={submitting}>
            취소
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
        <AlertIcon className="size-3.5" />
        관리자 조치 — 이 처리는 되돌릴 수 없습니다
      </p>

      {error && (
        <p className="rounded-card border border-destructive/30 bg-destructive-muted px-3 py-2 text-destructive">
          {error}
        </p>
      )}

      {targetDeleted && (
        <p className="text-xs text-muted-foreground">대상이 이미 삭제되어 &apos;반려&apos;만 선택할 수 있습니다.</p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">처리 상태 선택</span>
        <select
          value={decision}
          onChange={(e) => setDecision(e.target.value as "dismiss" | "action")}
          className={FIELD_CLASS}
        >
          <option value="dismiss">반려</option>
          <option value="action" disabled={targetDeleted}>
            조치 완료
          </option>
        </select>
      </label>

      {decision === "action" && (
        <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive-muted p-3">
          <p className="text-xs font-medium text-destructive">
            조치: {MODERATION_ACTION_TYPE_LABELS[actionType]}
          </p>
          {actionType === "suspend_user" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">정지 기간</span>
              <div className="flex gap-3">
                {(["7", "30", "permanent"] as const).map((v) => (
                  <label key={v} className="flex items-center gap-1.5 text-xs text-foreground">
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
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">제재 사유 (선택)</span>
            <input
              type="text"
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              className={`${FIELD_CLASS} bg-card`}
            />
          </label>
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">관리자 메모 (선택)</span>
        <textarea value={adminNote} onChange={(e) => setAdminNote(e.target.value)} rows={2} className={FIELD_CLASS} />
      </label>

      <Button type="button" variant={decision === "action" ? "destructive" : "primary"} size="sm" onClick={() => setConfirming(true)} className="self-start">
        처리하기
      </Button>
    </div>
  );
}
