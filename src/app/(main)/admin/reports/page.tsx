import Link from "next/link";

import { requireAdmin } from "@/lib/auth/session";
import { listReportsForAdmin } from "@/lib/moderation/service";
import { REPORT_STATUSES_FOR_FILTER, REPORT_TARGET_TYPES_FOR_FILTER } from "@/lib/moderation/schema";
import { REPORT_STATUS_LABELS, REPORT_TARGET_TYPE_LABELS } from "@/lib/report/schema";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const PAGE_SIZE = 20;

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; targetType?: string; page?: string }>;
}) {
  const admin = await requireAdmin(); // redirects unless logged in, ready, and DB-flagged admin

  const { status: statusParam, targetType: targetTypeParam, page: pageParam } = await searchParams;
  const status = REPORT_STATUSES_FOR_FILTER.find((s) => s === statusParam);
  const targetType = REPORT_TARGET_TYPES_FOR_FILTER.find((t) => t === targetTypeParam);
  const page = Math.max(1, Number(pageParam) || 1);

  const result = await listReportsForAdmin(admin, { status, targetType, page, limit: PAGE_SIZE });
  const { items, total, totalPages } = result.kind === "ok" ? result.data : { items: [], total: 0, totalPages: 1 };

  function filterHref(next: { status?: string; targetType?: string }) {
    const params = new URLSearchParams();
    if (next.status ?? status) params.set("status", next.status ?? status!);
    if (next.targetType ?? targetType) params.set("targetType", next.targetType ?? targetType!);
    return `/admin/reports${params.toString() ? `?${params}` : ""}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">🛡️ 관리자 - 신고 처리</h1>

      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">처리 상태</span>
          <div className="flex gap-2">
            <Link
              href={`/admin/reports${targetType ? `?targetType=${targetType}` : ""}`}
              className={!status ? "font-semibold underline" : "text-zinc-500 dark:text-zinc-400"}
            >
              전체
            </Link>
            {REPORT_STATUSES_FOR_FILTER.map((s) => (
              <Link
                key={s}
                href={filterHref({ status: s })}
                className={status === s ? "font-semibold underline" : "text-zinc-500 dark:text-zinc-400"}
              >
                {REPORT_STATUS_LABELS[s]}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">신고 유형</span>
          <div className="flex gap-2">
            <Link
              href={`/admin/reports${status ? `?status=${status}` : ""}`}
              className={!targetType ? "font-semibold underline" : "text-zinc-500 dark:text-zinc-400"}
            >
              전체
            </Link>
            {REPORT_TARGET_TYPES_FOR_FILTER.map((t) => (
              <Link
                key={t}
                href={filterHref({ targetType: t })}
                className={targetType === t ? "font-semibold underline" : "text-zinc-500 dark:text-zinc-400"}
              >
                {REPORT_TARGET_TYPE_LABELS[t]}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {page}페이지 · {items.length}건 표시 (전체 {total}건)
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">조건에 맞는 신고가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((r) => (
            <Link
              key={r.id}
              href={`/admin/reports/${r.id}`}
              className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-4 text-sm hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">신고 #{r.id}</span>
                <span className="text-zinc-400 dark:text-zinc-500">·</span>
                <span>{REPORT_TARGET_TYPE_LABELS[r.targetType]}</span>
                <span className="text-zinc-400 dark:text-zinc-500">·</span>
                <span>{REPORT_STATUS_LABELS[r.status]}</span>
              </div>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                신고자: {r.reporterNickname ?? "알 수 없음"} · 신고일: {formatDate(r.createdAt)}
              </span>
              <span className="text-zinc-600 dark:text-zinc-400">사유: {r.reason}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 text-sm">
        {page > 1 && (
          <Link href={`${filterHref({})}${filterHref({}).includes("?") ? "&" : "?"}page=${page - 1}`} className="underline">
            이전 페이지
          </Link>
        )}
        {page < totalPages && (
          <Link href={`${filterHref({})}${filterHref({}).includes("?") ? "&" : "?"}page=${page + 1}`} className="underline">
            다음 페이지
          </Link>
        )}
      </div>
    </div>
  );
}
