import { notFound, redirect } from "next/navigation";

import { requireActiveUser } from "@/lib/auth/session";
import {
  getOrganizationById,
  getOrganizationMembers,
  getOrganizationRole,
  listJoinRequestsForOrganization,
} from "@/lib/organization/service";
import { OrganizationProfileEditForm } from "@/components/organization/OrganizationProfileEditForm";
import { OrganizationJoinRequestQueue } from "@/components/organization/OrganizationJoinRequestQueue";
import { OrganizationMemberManagement } from "@/components/organization/OrganizationMemberManagement";
import { OrganizationLeadershipTransfer } from "@/components/organization/OrganizationLeadershipTransfer";
import { OrganizationDeactivateControl } from "@/components/organization/OrganizationDeactivateControl";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

// Phase 12-4 §10/§26: 페이지 자체의 requireActiveUser() + getOrganizationRole()
// 확인은 첫 방어선일 뿐이다 -- 아래에서 렌더링하는 모든 액션(프로필 수정,
// 가입 신청 승인/거절, 멤버 관리, LEADER 승계, 비활성화)은 각자 자신의
// 서비스 함수 안에서 canManageOrganization/canManageMembers/canAppointAdmin/
// canRemoveMember/canTransferLeadership/canDeactivateOrganization을 다시
// 확인한다. LEADER/ADMIN이 아니면 이 페이지 자체가 렌더링되지 않고 "/"로
// redirect -- requireAdmin()이 비관리자를 처리하는 것과 동일한 관례("접근
// 거부" 전용 페이지가 이 앱에 없음).
export default async function OrganizationSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const organization = await getOrganizationById(id);
  if (!organization) notFound();

  const myRole = await getOrganizationRole(id, user.id);
  if (myRole !== "leader" && myRole !== "admin") redirect("/");

  const [members, joinRequestsResult] = await Promise.all([
    getOrganizationMembers(id),
    listJoinRequestsForOrganization(user.id, id),
  ]);
  const joinRequests = joinRequestsResult.kind === "ok" ? joinRequestsResult.data : [];

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold text-foreground">{organization.name} · 단체 설정</h1>

      <Section title="단체 기본 정보">
        <OrganizationProfileEditForm organizationId={id} organization={organization} />
      </Section>

      <Section title="가입 신청 관리">
        <OrganizationJoinRequestQueue organizationId={id} requests={joinRequests} />
      </Section>

      <Section title="구성원 관리">
        <OrganizationMemberManagement organizationId={id} members={members} myRole={myRole} myUserId={user.id} />
      </Section>

      {myRole === "leader" && (
        <Section title="대표 관리자 위임">
          <OrganizationLeadershipTransfer organizationId={id} members={members} myUserId={user.id} />
        </Section>
      )}

      {myRole === "leader" && organization.status === "active" && (
        <Section title="단체 비활성화">
          <OrganizationDeactivateControl organizationId={id} />
        </Section>
      )}
    </div>
  );
}
