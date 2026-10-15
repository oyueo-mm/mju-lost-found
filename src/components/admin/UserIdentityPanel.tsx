"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/Button";
import { IdentityResult } from "@/components/admin/ReportIdentityPanel";
import {
  viewReportPartyIdentityAction,
  type IdentityViewState,
} from "@/app/(main)/admin/reports/[id]/identityActions";

export type UserIdentityReportOption = { id: number; label: string };

// 관리자 사용자 상세의 이름·소속 열람. The privacy policy (§5) and the
// 이름·소속 consent allow an admin to view them only for a report in which
// this member is the reporter or the reported party, with a reason, and
// every view is logged -- so the admin picks one of those reports. The form
// goes to the same server action as the report screen
// (viewReportPartyIdentityAction -> viewIdentityForReport: admin check,
// party check, reason check, IdentityAccessLog entry). Nothing is loaded
// until then; the user list never shows these values.
export function UserIdentityPanel({ userId, reports }: { userId: number; reports: UserIdentityReportOption[] }) {
  const [state, formAction, pending] = useActionState<IdentityViewState, FormData>(viewReportPartyIdentityAction, null);

  if (reports.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        이 이용자가 신고자나 피신고자인 신고가 없어 이름·소속을 열람할 수 없습니다. 개인정보 처리방침상 이름·소속은 신고·분쟁 처리 중인
        신고의 당사자에 한해 열람할 수 있습니다.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs leading-relaxed text-muted-foreground">
        이 이용자가 신고자나 피신고자인 신고를 처리하는 데 꼭 필요한 경우에만 열람하세요. 열람할 때마다 관리자, 대상, 신고, 사유, 시각이
        기록됩니다. 이름·소속은 Google 표시 이름에서 자동으로 가져왔거나 이용자가 직접 입력한 정보로, 학교 학적 시스템에서 확인된 정보가
        아닙니다.
      </p>
      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="targetUserId" value={userId} />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">관련 신고</span>
          <select
            name="reportId"
            required
            disabled={pending}
            className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
          >
            {reports.map((report) => (
              <option key={report.id} value={report.id}>
                {report.label}
              </option>
            ))}
          </select>
        </label>
        <textarea
          name="reason"
          required
          minLength={5}
          maxLength={500}
          rows={2}
          aria-label="열람 사유"
          placeholder="열람 사유 (예: 습득물 반환 분쟁 확인을 위한 당사자 확인)"
          disabled={pending}
          className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={pending} className="self-start">
          {pending ? "확인 중..." : "이름·소속 열람 (기록됨)"}
        </Button>
      </form>
      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <IdentityResult state={state} />}
    </div>
  );
}
