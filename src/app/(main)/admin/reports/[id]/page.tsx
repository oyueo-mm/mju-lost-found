import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/session";
import { getReportForAdmin } from "@/lib/moderation/service";
import { MODERATION_ACTION_TYPE_LABELS } from "@/lib/moderation/schema";
import { REPORT_STATUS_LABELS, REPORT_TARGET_TYPE_LABELS, type ReportStatusValue } from "@/lib/report/schema";
import { ReportProcessForm } from "@/components/admin/ReportProcessForm";
import { ShieldIcon, AlertIcon } from "@/components/icons";

const STATUS_TONE_CLASSES: Record<ReportStatusValue, string> = {
  pending: "bg-warning-muted text-warning",
  dismissed: "bg-muted text-muted-foreground",
  actioned: "bg-success-muted text-success",
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default async function AdminReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const result = await getReportForAdmin(admin, id);
  if (result.kind === "not_found") notFound();
  if (result.kind !== "ok") {
    return (
      <div className="rounded-card border border-destructive/30 bg-destructive-muted p-4 text-sm text-destructive">
        신고 정보를 불러오는 중 문제가 발생했습니다.
      </div>
    );
  }

  const report = result.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
            <ShieldIcon className="size-4.5" />
          </span>
          <h1 className="text-lg font-semibold text-foreground">
            신고 #{report.id} · {REPORT_TARGET_TYPE_LABELS[report.targetType]}
          </h1>
        </div>
        <Link href="/admin/reports" className="text-sm font-medium text-muted-foreground hover:text-foreground">
          목록으로
        </Link>
      </div>

      {/* 1. 신고 대상 */}
      <Section title="신고 대상">
        {report.targetDeleted || !report.targetInfo ? (
          <p className="flex items-center gap-1.5 text-sm text-warning">
            <AlertIcon className="size-4 shrink-0" />
            신고 대상이 삭제되었습니다. (신고 기록은 계속 보관됩니다)
          </p>
        ) : report.targetInfo.kind === "post" ? (
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {report.targetInfo.postKind === "lost" ? "찾아요(분실물)" : "찾았어요(습득물)"} · {report.targetInfo.title}
            </span>
            <span className="text-muted-foreground">{report.targetInfo.description}</span>
            <span className="text-xs text-muted-foreground">
              작성자: {report.targetInfo.authorNickname ?? "알 수 없음"} · {report.targetInfo.category} ·{" "}
              {report.targetInfo.location ?? "위치 미상"} · 상태: {report.targetInfo.status} · 작성일:{" "}
              {formatDate(report.targetInfo.createdAt)}
            </span>
          </div>
        ) : report.targetInfo.kind === "message" ? (
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">대상 메시지</span>
            <span className="text-muted-foreground">{report.targetInfo.content}</span>
            <span className="text-xs text-muted-foreground">
              작성자: {report.targetInfo.senderNickname ?? "알 수 없음"} · 작성일:{" "}
              {formatDate(report.targetInfo.createdAt)}
            </span>
            <Link
              href={`/admin/chat/${report.targetInfo.chatRoomId}?report=${report.id}`}
              className="text-xs font-medium text-primary hover:opacity-80"
            >
              채팅방으로 이동
            </Link>
          </div>
        ) : report.targetInfo.kind === "comment" ? (
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              대상 댓글{report.targetInfo.parentId !== null ? " (답글)" : ""}
            </span>
            <span className="text-muted-foreground">{report.targetInfo.content}</span>
            <span className="text-xs text-muted-foreground">
              작성자: {report.targetInfo.authorNickname ?? "알 수 없음"} · 작성일:{" "}
              {formatDate(report.targetInfo.createdAt)}
            </span>
            <Link
              href={`/post/${report.targetInfo.postId}?type=${report.targetInfo.postType}`}
              className="text-xs font-medium text-primary hover:opacity-80"
            >
              게시물로 이동
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">대상 사용자</span>
            <span className="text-muted-foreground">닉네임: {report.targetInfo.nickname ?? "알 수 없음"}</span>
          </div>
        )}
      </Section>

      {/* 2. 신고 사유 */}
      <Section title="신고 사유">
        <p className="text-sm text-foreground">{report.reason}</p>
        {report.detail && <p className="text-sm text-muted-foreground">{report.detail}</p>}
      </Section>

      {/* 3. 신고자 / 관련 정보 */}
      <Section title="신고자 정보">
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <span>신고자: {report.reporterNickname ?? "알 수 없음"}</span>
          <span>신고일: {formatDate(report.createdAt)}</span>
        </div>
      </Section>

      {/* 4. 현재 처리 상태 */}
      <Section title="처리 상태">
        <span
          className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE_CLASSES[report.status]}`}
        >
          {REPORT_STATUS_LABELS[report.status]}
        </span>
      </Section>

      {/* 5. 관리자 처리 영역 / 6. 처리 결과·제재 정보 */}
      {report.status === "pending" ? (
        <Section title="관리자 처리">
          <ReportProcessForm
            reportId={report.id}
            targetType={report.targetType}
            targetDeleted={report.targetDeleted}
          />
        </Section>
      ) : (
        <Section title="처리 결과">
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <span>
              처리자: {report.processedByNickname ?? "-"} · 처리일:{" "}
              {report.processedAt ? formatDate(report.processedAt) : "-"}
            </span>
            {report.adminNote && <span>관리자 메모: {report.adminNote}</span>}
            {report.moderationAction && (
              <div className="mt-1 flex flex-col gap-0.5 rounded-lg border border-border bg-muted p-3">
                <span className="font-medium text-foreground">
                  조치: {MODERATION_ACTION_TYPE_LABELS[report.moderationAction.actionType]}
                </span>
                <span>
                  조치 처리자: {report.moderationAction.adminNickname ?? "알 수 없음"} · 조치일:{" "}
                  {formatDate(report.moderationAction.createdAt)}
                </span>
                {report.moderationAction.reason && <span>조치 사유: {report.moderationAction.reason}</span>}
                {report.moderationAction.actionType === "suspend_user" && (
                  <span>
                    기간:{" "}
                    {report.moderationAction.expiresAt === null
                      ? "영구"
                      : `${formatDate(report.moderationAction.expiresAt)}까지`}
                  </span>
                )}
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}
