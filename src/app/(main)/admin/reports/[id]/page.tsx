import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/session";
import { getReportForAdmin } from "@/lib/moderation/service";
import { MODERATION_ACTION_TYPE_LABELS } from "@/lib/moderation/schema";
import { REPORT_STATUS_LABELS, REPORT_TARGET_TYPE_LABELS } from "@/lib/report/schema";
import { ReportProcessForm } from "@/components/admin/ReportProcessForm";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
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
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        신고 정보를 불러오는 중 문제가 발생했습니다.
      </div>
    );
  }

  const report = result.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          신고 #{report.id} · {REPORT_TARGET_TYPE_LABELS[report.targetType]} · {REPORT_STATUS_LABELS[report.status]}
        </h1>
        <Link href="/admin/reports" className="text-sm text-zinc-500 underline dark:text-zinc-400">
          목록으로
        </Link>
      </div>

      <div className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
        <span>신고자: {report.reporterNickname ?? "알 수 없음"}</span>
        <span>신고일: {formatDate(report.createdAt)}</span>
        <span>사유: {report.reason}</span>
        {report.detail && <span>상세 내용: {report.detail}</span>}
      </div>

      <div className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        {report.targetDeleted || !report.targetInfo ? (
          <p className="text-amber-700 dark:text-amber-400">
            ⚠️ 신고 대상이 삭제되었습니다. (신고 기록은 계속 보관됩니다)
          </p>
        ) : report.targetInfo.kind === "post" ? (
          <div className="flex flex-col gap-1">
            <span className="font-medium">
              대상 게시물 ({report.targetInfo.postKind === "lost" ? "찾아요(분실물)" : "찾았어요(습득물)"})
            </span>
            <span>제목: {report.targetInfo.title}</span>
            <span>설명: {report.targetInfo.description}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              작성자: {report.targetInfo.authorNickname ?? "알 수 없음"} · {report.targetInfo.category} ·{" "}
              {report.targetInfo.location} · 상태: {report.targetInfo.status} · 작성일:{" "}
              {formatDate(report.targetInfo.createdAt)}
            </span>
          </div>
        ) : report.targetInfo.kind === "message" ? (
          <div className="flex flex-col gap-1">
            <span className="font-medium">대상 메시지</span>
            <span>{report.targetInfo.content}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              작성자: {report.targetInfo.senderNickname ?? "알 수 없음"} · 작성일:{" "}
              {formatDate(report.targetInfo.createdAt)}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="font-medium">대상 사용자</span>
            <span>닉네임: {report.targetInfo.nickname ?? "알 수 없음"}</span>
          </div>
        )}
      </div>

      {report.status === "pending" ? (
        <ReportProcessForm
          reportId={report.id}
          targetType={report.targetType}
          targetDeleted={report.targetDeleted}
        />
      ) : (
        <div className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
          <span>
            처리자: {report.processedByNickname ?? "-"} · 처리일:{" "}
            {report.processedAt ? formatDate(report.processedAt) : "-"}
          </span>
          {report.adminNote && <span>관리자 메모: {report.adminNote}</span>}
          {report.moderationAction && (
            <div className="mt-1 flex flex-col gap-0.5">
              <span>조치: {MODERATION_ACTION_TYPE_LABELS[report.moderationAction.actionType]}</span>
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
      )}
    </div>
  );
}
