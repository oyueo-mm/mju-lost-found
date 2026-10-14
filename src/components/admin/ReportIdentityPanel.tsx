"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/Button";
import {
  viewReportPartyIdentityAction,
  type IdentityViewState,
} from "@/app/(main)/admin/reports/[id]/identityActions";

type Party = { userId: number; role: "신고자" | "피신고자"; nickname: string | null };

// Where a saved value came from -- none of these is a school-verified record.
const SOURCE_LABELS: Record<string, string> = {
  self: "직접 입력",
  google_profile: "Google 계정 이름을 본인이 확인",
  google_display_name: "Google 표시 이름(이름/신분/소속)에서 자동 수집 · 로그인 시 갱신 · 학적 검증 아님 · 소속은 단과대학일 수 있음",
  google_people: "Google 프로필 소속을 본인이 확인",
};
const sourceLabel = (source: string | null) => (source ? (SOURCE_LABELS[source] ?? source) : null);

// 신고 당사자 실명·학과 열람 (관리자). Nothing is loaded until the admin
// picks one of this report's two parties and writes a reason; each view is
// recorded (IdentityAccessLog) with that reason.
export function ReportIdentityPanel({ reportId, parties }: { reportId: number; parties: Party[] }) {
  const [state, formAction, pending] = useActionState<IdentityViewState, FormData>(viewReportPartyIdentityAction, null);

  if (parties.length === 0) {
    return <p className="text-sm text-muted-foreground">열람할 수 있는 당사자가 없습니다.</p>;
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs leading-relaxed text-muted-foreground">
        신고·분쟁 처리에 꼭 필요한 경우에만 열람하세요. 열람할 때마다 관리자, 대상, 신고, 사유, 시각이 기록됩니다. 실명·학과는
        이용자가 직접 입력한 정보로, 학적과 대조해 확인된 정보가 아닙니다.
      </p>
      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="reportId" value={reportId} />
        <div className="flex flex-wrap gap-3">
          {parties.map((party, index) => (
            <label key={party.userId} className="flex items-center gap-1.5">
              <input type="radio" name="targetUserId" value={party.userId} defaultChecked={index === 0} disabled={pending} />
              {party.role}: {party.nickname ?? "알 수 없음"}
            </label>
          ))}
        </div>
        <textarea
          name="reason"
          required
          minLength={5}
          maxLength={500}
          rows={2}
          placeholder="열람 사유 (예: 습득물 반환 분쟁 확인을 위한 당사자 확인)"
          disabled={pending}
          className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={pending} className="self-start">
          {pending ? "확인 중..." : "실명·학과 열람 (기록됨)"}
        </Button>
      </form>
      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-border bg-muted p-3">
          <dt className="text-muted-foreground">닉네임</dt>
          <dd className="text-foreground">{state.nickname ?? "-"}</dd>
          <dt className="text-muted-foreground">실명</dt>
          <dd className="text-foreground">
            {state.realName ?? "미등록"}
            {state.realName && <span className="ml-1.5 text-xs text-muted-foreground">({sourceLabel(state.realNameSource)})</span>}
          </dd>
          <dt className="text-muted-foreground">학과(소속)</dt>
          <dd className="text-foreground">
            {state.department ?? "미등록"}
            {state.department && <span className="ml-1.5 text-xs text-muted-foreground">({sourceLabel(state.departmentSource)})</span>}
          </dd>
          {state.updatedAt && (
            <>
              <dt className="text-muted-foreground">최종 수정</dt>
              <dd className="text-foreground">
                {new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(
                  new Date(state.updatedAt),
                )}
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
