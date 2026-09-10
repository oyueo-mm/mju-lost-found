import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/session";
import { getOrganizationById, getOrganizationCreationRequestForAdmin } from "@/lib/organization/service";
import { ORGANIZATION_REQUEST_STATUS_LABELS } from "@/lib/organization/schema";
import { OrganizationRequestReviewForm } from "@/components/admin/OrganizationRequestReviewForm";
import { ShieldIcon } from "@/components/icons";

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

// Phase 12-3: admin/reports/[id]/page.tsx와 동일한 상세 페이지 구조(내용 /
// 신청자 정보 / 현재 상태 / 관리자 처리 섹션). getOrganizationCreationRequestForAdmin()이
// isAdmin()을 자체 재검증하므로 이 페이지의 requireAdmin() 게이트는 첫
// 방어선일 뿐이다.
export default async function AdminOrganizationRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const result = await getOrganizationCreationRequestForAdmin(admin, id);
  if (result.kind === "not_found") notFound();
  if (result.kind !== "ok") {
    return (
      <div className="rounded-card border border-destructive/30 bg-destructive-muted p-4 text-sm text-destructive">
        신청 정보를 불러오는 중 문제가 발생했습니다.
      </div>
    );
  }

  const request = result.data;
  // §8: 승인된 경우 생성된 Organization도 확인할 수 있게 한다 -- 별도
  // /organizations/[id] 페이지 없이(이번 Phase 범위 밖) 이 상세 페이지
  // 안에서 바로 보여준다.
  const resultingOrganization =
    request.resultingOrganizationId !== null ? await getOrganizationById(request.resultingOrganizationId) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
            <ShieldIcon className="size-4.5" />
          </span>
          <h1 className="text-lg font-semibold text-foreground">
            단체 생성 신청 #{request.id} · {request.organizationType}
          </h1>
        </div>
        <Link href="/admin/organization-requests" className="text-sm font-medium text-muted-foreground hover:text-foreground">
          목록으로
        </Link>
      </div>

      <Section title="신청 내용">
        <p className="font-medium text-foreground">{request.organizationName}</p>
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <span>활동 범위: {request.scope ?? "미기재"}</span>
          <span>연락 이메일: {request.contactEmail}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{request.purpose}</p>
      </Section>

      <Section title="신청자 정보">
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <span>신청자: {request.requester.nickname ?? "알 수 없음"}</span>
          <span>신청일: {formatDate(request.createdAt)}</span>
        </div>
      </Section>

      <Section title="현재 상태">
        <span className="inline-flex w-fit items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
          {ORGANIZATION_REQUEST_STATUS_LABELS[request.status]}
        </span>
      </Section>

      {request.status === "pending" ? (
        <Section title="관리자 처리">
          <OrganizationRequestReviewForm requestId={request.id} />
        </Section>
      ) : (
        <Section title="처리 결과">
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <span>
              처리자: {request.reviewedBy?.nickname ?? "-"} · 처리일: {request.reviewedAt ? formatDate(request.reviewedAt) : "-"}
            </span>
            {request.adminNote && <span>관리자 메모: {request.adminNote}</span>}
            {request.status === "rejected" && request.rejectionReason && (
              <span className="text-destructive">거절 사유: {request.rejectionReason}</span>
            )}
            {request.status === "approved" && resultingOrganization && (
              <div className="mt-1 flex flex-col gap-0.5 rounded-lg border border-border bg-muted p-3">
                <span className="font-medium text-foreground">생성된 단체: {resultingOrganization.name}</span>
                <span>상태: {resultingOrganization.status === "active" ? "활성" : "비활성"}</span>
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}
