import { redirect } from "next/navigation";

import { requireReadyUser } from "@/lib/auth/session";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { getLatestSuspensionRecord } from "@/lib/moderation/service";
import { getLatestAppealForUser } from "@/lib/moderation/appeals";
import { AppealForm } from "@/components/moderation/AppealForm";
import { AlertIcon, ClockIcon } from "@/components/icons";

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(
    date,
  );
}

// Coarse remaining-time text, same bucket style CommentSection's own
// formatRelativeTime uses -- this is "남은 정지 시간" (a rough sense of how
// much longer), not a live countdown.
function formatRemaining(until: Date): string {
  const diffMs = until.getTime() - Date.now();
  if (diffMs <= 0) return "곧 해제";
  const minutes = Math.ceil(diffMs / 60000);
  if (minutes < 60) return `약 ${minutes}분 남음`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `약 ${hours}시간 남음`;
  const days = Math.ceil(hours / 24);
  return `약 ${days}일 남음`;
}

// Phase I: this phase's own spec section 1 -- previously unreachable
// (requireActiveUser(), the only thing that ever redirected here, was
// never actually called by any page -- see (main)/layout.tsx's own new
// suspension gate, added this phase, which is what makes this page
// reachable in normal use for the first time). Landing page for a
// suspended user: clear status, reason, remaining time, suspension start
// time, permanent-or-not, and an appeal entry point -- restyled onto this
// app's real design-system tokens (bg-background/text-foreground/etc)
// instead of the old hardcoded zinc/black classes this page had before.
export default async function SuspendedPage() {
  const user = await requireReadyUser(); // redirects to /login or /onboarding as needed

  if (!isCurrentlySuspended(user)) {
    redirect("/");
  }

  const [record, latestAppeal] = await Promise.all([
    getLatestSuspensionRecord(user.id),
    getLatestAppealForUser(user.id),
  ]);

  const isPermanent = user.suspendedUntil === null;

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 px-6 py-12">
      <div className="flex w-full max-w-md flex-col gap-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-destructive-muted text-destructive">
            <AlertIcon className="size-7" />
          </span>
          <h1 className="text-xl font-semibold text-foreground">계정이 정지되었습니다</h1>
          <p className="text-sm text-muted-foreground">
            관리자 조치로 게시글 작성, 댓글, 채팅 등 대부분의 기능을 이용할 수 없습니다.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-card border border-destructive/30 bg-destructive-muted p-5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">정지 유형</span>
            <span className="font-semibold text-destructive">{isPermanent ? "영구 정지" : "기간 정지"}</span>
          </div>
          {!isPermanent && user.suspendedUntil && (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">해제 예정</span>
                <span className="font-medium text-foreground">{formatDateTime(user.suspendedUntil)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <ClockIcon className="size-3.5" />
                  남은 시간
                </span>
                <span className="font-medium text-foreground">{formatRemaining(user.suspendedUntil)}</span>
              </div>
            </>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">정지 시작</span>
            <span className="font-medium text-foreground">
              {record?.startedAt ? formatDateTime(record.startedAt) : "확인 불가"}
            </span>
          </div>
          <div className="flex flex-col gap-1 border-t border-destructive/20 pt-3">
            <span className="text-muted-foreground">정지 사유</span>
            {record ? (
              <>
                <span className="w-fit rounded-full bg-card px-2.5 py-0.5 text-xs font-medium text-foreground">
                  {record.reasonCategory ?? "미분류"}
                </span>
                <p className="whitespace-pre-wrap text-foreground">{record.reason ?? "등록된 상세 사유가 없습니다."}</p>
              </>
            ) : (
              <p className="text-foreground">등록된 사유 정보가 없습니다.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-foreground">이의신청</h2>
            <p className="text-xs text-muted-foreground">
              정지 사유에 동의하지 않으신다면 이의신청을 남겨주세요. 운영자가 확인합니다.
            </p>
          </div>
          {latestAppeal ? (
            <p
              className={`rounded-card border px-4 py-3 text-sm ${
                latestAppeal.reviewedAt
                  ? "border-border bg-muted text-muted-foreground"
                  : "border-primary/30 bg-primary-muted text-primary"
              }`}
            >
              {latestAppeal.reviewedAt
                ? `이의신청이 검토 완료되었습니다. (제출: ${formatDateTime(latestAppeal.createdAt)})`
                : `이의신청이 제출되어 검토 대기 중입니다. (제출: ${formatDateTime(latestAppeal.createdAt)})`}
            </p>
          ) : (
            <AppealForm />
          )}
        </div>
      </div>
    </div>
  );
}
