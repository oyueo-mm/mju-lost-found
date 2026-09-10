import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { getMyPendingJoinRequest, getOrganizationById, getOrganizationMembers } from "@/lib/organization/service";
import { listRecentPostsByOrganization } from "@/lib/posts/service";
import { LinkButton } from "@/components/ui/Button";
import { ShieldIcon, UserIcon } from "@/components/icons";
import { OrganizationJoinControls } from "@/components/organization/OrganizationJoinControls";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";

const ROLE_LABELS = { leader: "대표 관리자", admin: "관리자", member: "구성원" } as const;

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

// Phase 12-4 §5/§24: /lost, /found와 동일하게 비로그인 사용자도 조회 가능
// (organizations/page.tsx와 동일한 posture). notFound()는 이 프로젝트의
// 기존 관례(admin/organization-requests/[id]/page.tsx 등)를 그대로 따른다.
// §25: 멤버 목록은 닉네임/publicId/가입일/역할만 노출하고, 이메일/Google ID
// 등 인증 정보는 절대 포함하지 않는다(getOrganizationMembers 자체가 이미
// 그렇게 select한다).
export default async function OrganizationProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const organization = await getOrganizationById(id);
  if (!organization) notFound();

  const [members, user, recentPosts] = await Promise.all([
    getOrganizationMembers(id),
    getCurrentUser(),
    listRecentPostsByOrganization(id),
  ]);

  const myMembership = user ? members.find((m) => m.user.id === user.id) : undefined;
  const pendingRequest = user && !myMembership ? await getMyPendingJoinRequest(id, user.id) : null;

  const grouped = {
    leader: members.filter((m) => m.role === "leader"),
    admin: members.filter((m) => m.role === "admin"),
    member: members.filter((m) => m.role === "member"),
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
          <ShieldIcon className="size-6.5" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">{organization.name}</h1>
            {organization.status === "inactive" && (
              <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                비활성화됨
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {organization.organizationType}
            {organization.scope ? ` · ${organization.scope}` : ""}
          </p>
        </div>
      </div>

      {organization.description && (
        <p className="whitespace-pre-wrap rounded-card border border-border bg-card p-4 text-sm text-foreground">
          {organization.description}
        </p>
      )}

      <div className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 text-sm text-muted-foreground">
        {organization.contactEmail && <span>연락 이메일: {organization.contactEmail}</span>}
        <span>구성원 수: {members.length}명</span>
      </div>

      {myMembership && (myMembership.role === "leader" || myMembership.role === "admin") && (
        <LinkButton href={`/organizations/${id}/settings`} variant="secondary" size="sm" className="self-start">
          단체 설정 관리
        </LinkButton>
      )}

      <OrganizationJoinControls
        organizationId={id}
        organizationStatus={organization.status}
        isLoggedIn={user !== null}
        myRole={myMembership?.role ?? null}
        pendingRequestId={pendingRequest?.id ?? null}
      />

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-foreground">구성원</h2>
        {(["leader", "admin", "member"] as const).map((role) =>
          grouped[role].length === 0 ? null : (
            <div key={role} className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">{ROLE_LABELS[role]}</p>
              <ul className="flex flex-col gap-2">
                {grouped[role].map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center gap-3 rounded-card border border-border bg-card p-3"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <UserIcon className="size-4.5" />
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
      </section>

      {/* Phase 12-5 §30: minimal connection to posts -- a "최근 게시글"
          preview only, not a full paginated listing (out of scope this
          phase). Reuses listRecentPostsByOrganization (posts/service.ts)
          and the existing PostCard component unchanged. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">최근 게시글</h2>
        {recentPosts.length === 0 ? (
          <EmptyState title="아직 이 단체 명의로 작성된 게시글이 없습니다" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {recentPosts.map((post) => (
              <PostCard key={`${post.type}-${post.id}`} post={post} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
