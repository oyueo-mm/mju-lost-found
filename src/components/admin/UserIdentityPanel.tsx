"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { IdentityResult } from "@/components/admin/ReportIdentityPanel";
import {
  viewReportPartyIdentityAction,
  type IdentityViewState,
} from "@/app/(main)/admin/reports/[id]/identityActions";
import { viewMemberIdentityForPurposeAction } from "@/app/(main)/admin/users/[id]/identityActions";
import { IDENTITY_PURPOSE_LABELS, OPERATING_IDENTITY_PURPOSES, type IdentityViewPurpose } from "@/lib/identity/purposes";

export type UserIdentityReportOption = { id: number; label: string };

// 관리자 사용자 상세의 이름·소속 열람. The admin picks why -- one of the
// purposes the privacy policy (§5) names -- and writes a reason:
// - 신고 처리: one of the reports this member is the reporter or reported
//   party of, through the report screen's own action;
// - 분실물 인계 문의 / 소유권 분쟁 / 사칭 의심: no report needed, but only for
//   a member who agreed to the consent naming these purposes (checked on
//   the server).
// Both actions re-check the admin, the purpose and the reason on the server
// and log every view (IdentityAccessLog). Nothing is loaded before that;
// the user list never shows these values.
export function UserIdentityPanel({
  userId,
  reports,
  consentCoversOperatingPurposes,
}: {
  userId: number;
  reports: UserIdentityReportOption[];
  consentCoversOperatingPurposes: boolean;
}) {
  const [reportState, reportAction, reportPending] = useActionState<IdentityViewState, FormData>(viewReportPartyIdentityAction, null);
  const [purposeState, purposeAction, purposePending] = useActionState<IdentityViewState, FormData>(
    viewMemberIdentityForPurposeAction,
    null,
  );
  const [purpose, setPurpose] = useState<IdentityViewPurpose | "">("");
  const isReport = purpose === "report";
  const pending = reportPending || purposePending;
  const state = isReport ? reportState : purposeState;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs leading-relaxed text-muted-foreground">
        아래 목적 중 하나에 꼭 필요한 경우에만 열람하세요. 열람할 때마다 관리자, 대상, 목적, 관련 신고, 사유, 시각이 기록됩니다.
        이름·소속은 Google 표시 이름에서 자동으로 가져왔거나 이용자가 직접 입력한 정보로, 학교 학적 시스템에서 확인된 정보가
        아닙니다.
      </p>
      <form action={isReport ? reportAction : purposeAction} className="flex flex-col gap-2">
        <input type="hidden" name="targetUserId" value={userId} />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">열람 목적</span>
          <select
            name="purpose"
            required
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as IdentityViewPurpose | "")}
            disabled={pending}
            className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
          >
            <option value="" disabled>
              목적을 선택하세요
            </option>
            <option value="report" disabled={reports.length === 0}>
              {IDENTITY_PURPOSE_LABELS.report}
              {reports.length === 0 ? " (관련 신고 없음)" : ""}
            </option>
            {OPERATING_IDENTITY_PURPOSES.map((p) => (
              <option key={p} value={p} disabled={!consentCoversOperatingPurposes}>
                {IDENTITY_PURPOSE_LABELS[p]}
                {consentCoversOperatingPurposes ? "" : " (개정 동의 전)"}
              </option>
            ))}
          </select>
        </label>
        {isReport && (
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
        )}
        {!consentCoversOperatingPurposes && (
          <p className="text-xs text-muted-foreground">
            이 이용자는 운영 목적 열람이 포함된 개정 동의를 아직 하지 않아, 관련 신고가 있을 때 신고 처리 목적으로만 열람할 수
            있습니다.
          </p>
        )}
        <textarea
          name="reason"
          required
          minLength={5}
          maxLength={500}
          rows={2}
          aria-label="열람 사유"
          placeholder="열람 사유 (예: 습득물 인계 요청자가 게시글 작성자와 같은 사람인지 확인)"
          disabled={pending}
          className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={pending || purpose === ""} className="self-start">
          {pending ? "확인 중..." : "이름·소속 열람 (기록됨)"}
        </Button>
      </form>
      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <IdentityResult state={state} />}
    </div>
  );
}
