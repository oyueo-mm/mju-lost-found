import Link from "next/link";

import { requireAdmin } from "@/lib/auth/session";
import { HOLD_REASON_LABELS, listRejoinRequestsForAdmin } from "@/lib/auth/rejoin";
import { RejoinReviewButtons } from "@/components/admin/RejoinReviewButtons";
import { ShieldIcon } from "@/components/icons";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(date);
}

const STATUS_LABELS = { PENDING: "대기", APPROVED: "승인", REJECTED: "거절" } as const;

// 회원탈퇴: rejoin requests from accounts that withdrew with a sanction
// matter still open. Approving never restores the old account -- the
// person's next sign-in creates a new one, unlinked from the old content.
export default async function AdminRejoinRequestsPage() {
  const admin = await requireAdmin();
  const requests = (await listRejoinRequestsForAdmin(admin)) ?? [];
  const pendingCount = requests.filter((r) => r.status === "PENDING").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <ShieldIcon className="size-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">재가입 요청</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          이용 정지 중이거나 처리 중인 신고·제재·이의신청이 있는 상태에서 탈퇴한 Google 계정의 재가입 요청입니다.
          승인하면 다음 로그인 때 새 계정이 만들어지며, 이전 계정과 콘텐츠는 연결되지 않습니다. 거절하면 해당 Google
          계정으로는 가입할 수 없습니다. 정지·미처리 신고·이의신청 등 보류 사유가 모두 끝나면 보류 식별값은 즉시
          삭제되고, 처리된 요청 기록은 처리 후 1년이 지나면 삭제됩니다.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-foreground">
          요청 목록 <span className="text-sm font-normal text-muted-foreground">대기 {pendingCount}건 · 전체 {requests.length}건</span>
        </h2>
        {requests.length === 0 ? (
          <p className="rounded-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            재가입 요청이 없어요.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {requests.map((r) => (
              <article key={r.id} className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">요청 #{r.id}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      r.status === "PENDING" ? "bg-primary-muted text-primary" : r.status === "APPROVED" ? "bg-muted text-foreground" : "bg-destructive-muted text-destructive"
                    }`}
                  >
                    {STATUS_LABELS[r.status]}
                  </span>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
                  {r.hold ? (
                    <>
                      <dt>탈퇴한 계정</dt>
                      <dd>
                        <Link href={`/admin/users/${r.hold.withdrawnUserId}`} className="text-primary hover:opacity-80">
                          사용자 #{r.hold.withdrawnUserId}
                        </Link>
                        {r.hold.withdrawnAt && ` · 탈퇴 ${formatDate(r.hold.withdrawnAt)}`}
                      </dd>
                      <dt>보류 사유</dt>
                      <dd>{r.hold.reasons.map((h) => HOLD_REASON_LABELS[h] ?? h).join(", ")}</dd>
                      <dt>정지 상태</dt>
                      <dd>
                        {r.hold.wasSuspended ? (r.hold.suspendedUntil ? `기간 정지 (~${formatDate(r.hold.suspendedUntil)})` : "영구 정지") : "정지 아님"}
                      </dd>
                    </>
                  ) : (
                    <>
                      <dt>보류</dt>
                      <dd>해제됨 (식별값 삭제)</dd>
                    </>
                  )}
                  <dt>요청일</dt>
                  <dd>{formatDate(r.createdAt)}</dd>
                </dl>
                <p className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-foreground">{r.reason}</p>
                {r.status === "PENDING" ? (
                  <RejoinReviewButtons requestId={r.id} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    처리: {r.reviewedByNickname ?? "-"} · {r.reviewedAt ? formatDate(r.reviewedAt) : "-"}
                    {r.reviewNote && ` · 메모: ${r.reviewNote}`}
                    {r.status === "APPROVED" && (r.consumedAt ? " · 새 계정 가입 완료" : " · 새 계정 가입 전")}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
