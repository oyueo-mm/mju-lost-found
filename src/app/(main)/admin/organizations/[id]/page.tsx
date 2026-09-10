import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/session";
import { getOrganizationForAdmin } from "@/lib/organization/service";
import { listRecentPostsByOrganization } from "@/lib/posts/service";
import { ORGANIZATION_STATUS_LABELS } from "@/lib/organization/schema";
import { ShieldIcon, UserIcon } from "@/components/icons";
import { OrganizationStatusToggle } from "@/components/admin/OrganizationStatusToggle";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";

const ROLE_LABELS = { leader: "대표 관리자", admin: "관리자", member: "구성원" } as const;

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(date);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

// Phase 12-6 §6/§11: getOrganizationForAdmin()이 isAdmin()을 자체
// 재검증하므로 이 페이지의 requireAdmin() 게이트는 첫 방어선일 뿐이다.
// organizationId는 URL 경로 파라미터에서 읽은 뒤 서버에서 다시 조회하며,
// 클라이언트가 Organization 객체 전체를 보낼 방법은 어디에도 없다(§11).
export default async function AdminOrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const result = await getOrganizationForAdmin(admin, id);
  if (result.kind === "not_found") notFound();
  if (result.kind !== "ok") {
    return (
      <div className="rounded-card border border-destructive/30 bg-destructive-muted p-4 text-sm text-destructive">
        단체 정보를 불러오는 중 문제가 발생했습니다.
      </div>
    );
  }

  const organization = result.data;
  // Phase 12-6 §16: Phase 12-5의 listRecentPostsByOrganization()을 그대로
  // 재사용 -- 새 API route/서비스 함수를 만들지 않는다. 이 페이지에서는
  // 게시글 자체를 수정/삭제하지 않는다(§16의 명시적 범위 제한).
  const recentPosts = await listRecentPostsByOrganization(id);

  const grouped = {
    leader: organization.members.filter((m) => m.role === "leader"),
    admin: organization.members.filter((m) => m.role === "admin"),
    member: organization.members.filter((m) => m.role === "member"),
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
            <ShieldIcon className="size-4.5" />
          </span>
          <h1 className="text-lg font-semibold text-foreground">{organization.name}</h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              organization.status === "active" ? "bg-primary-muted text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {ORGANIZATION_STATUS_LABELS[organization.status]}
          </span>
        </div>
        <Link href="/admin/organizations" className="text-sm font-medium text-muted-foreground hover:text-foreground">
          목록으로
        </Link>
      </div>

      <Section title="기본 정보">
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <span>단체 유형: {organization.organizationType}</span>
          <span>활동 범위: {organization.scope ?? "미기재"}</span>
          <span>연락 이메일: {organization.contactEmail ?? "미기재"}</span>
          <span>생성일: {formatDate(organization.createdAt)}</span>
          <span>수정일: {formatDate(organization.updatedAt)}</span>
        </div>
        {organization.description && (
          <p className="whitespace-pre-wrap text-sm text-foreground">{organization.description}</p>
        )}
      </Section>

      <Section title="상태 관리">
        <OrganizationStatusToggle organizationId={id} status={organization.status} />
        <p className="text-xs text-muted-foreground">
          비활성화해도 기존 게시글/댓글/구성원은 유지됩니다. 새 단체 게시글/댓글 작성과 가입 신청만 차단됩니다.
        </p>
      </Section>

      <Section title="구성원">
        {(["leader", "admin", "member"] as const).map((role) =>
          grouped[role].length === 0 ? null : (
            <div key={role} className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                {ROLE_LABELS[role]} ({grouped[role].length})
              </p>
              <ul className="flex flex-col gap-2">
                {grouped[role].map((m) => (
                  <li key={m.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <UserIcon className="size-4" />
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">{m.user.nickname ?? "닉네임 미설정"}</span>
                      <span className="text-xs text-muted-foreground">가입일: {formatDate(m.joinedAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ),
        )}
      </Section>

      <Section title="최근 게시글">
        {recentPosts.length === 0 ? (
          <EmptyState title="아직 이 단체 명의로 작성된 게시글이 없습니다" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {recentPosts.map((post) => (
              <PostCard key={`${post.type}-${post.id}`} post={post} />
            ))}
          </div>
        )}
      </Section>

      <Link
        href={`/organizations/${id}`}
        className="self-start text-sm font-medium text-primary hover:underline"
      >
        일반 사용자용 단체 프로필 보기 →
      </Link>
    </div>
  );
}
