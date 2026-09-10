import { prisma } from "@/lib/db/prisma";
import { OrganizationRole, OrganizationStatus } from "@/generated/prisma/client";

// Phase 12-2: every helper here re-fetches the caller's (and, where
// relevant, the target's) OrganizationMember row fresh from the DB on
// every call -- never trusts a client-supplied `role`, and never caches a
// membership/role across calls. This mirrors moderation/service.ts's own
// isAdmin() philosophy ("DB-sourced admin check only... never from
// client-controlled state"), just scoped to one organization instead of
// the whole app. Platform Admin (User.isAdmin) is a completely separate
// axis handled by the caller (requireAdmin()/isAdmin() from
// @/lib/moderation/service) -- nothing in this file reads or grants that
// flag; see canDeactivateOrganization's own comment for the one place
// this phase's design explicitly lets a Platform Admin override an
// org-scoped check.

export type OrganizationMembership = {
  id: number;
  organizationId: number;
  userId: number;
  role: OrganizationRole;
};

// The one place every helper below actually reads OrganizationMember from
// -- centralizing this makes the "always fresh, never cached" contract
// enforceable by inspection rather than by convention alone.
export async function getMembership(userId: number, organizationId: number): Promise<OrganizationMembership | null> {
  return prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
}

function isLeader(membership: OrganizationMembership | null): boolean {
  return membership?.role === OrganizationRole.LEADER;
}

function isAdminOrLeader(membership: OrganizationMembership | null): boolean {
  return membership?.role === OrganizationRole.LEADER || membership?.role === OrganizationRole.ADMIN;
}

// 단체 기본 정보 수정(name/description/organizationType/scope/contactEmail)
// -- ADMIN 이상. Phase 12-2 당시 이 함수는 아직 어떤 서비스 함수에서도
// 호출되지 않는 미사용 헬퍼였고(그때는 프로필 수정 기능 자체가 없었음),
// Phase 12-1 설계 문서는 이를 LEADER 전용으로 잠정 서술했었다. Phase 12-4
// §10/§11이 "ADMIN도 단체 기본 정보 수정 가능"을 명시적으로 요구하면서
// 실제 구현(updateOrganizationProfile) 시점에 맞춰 범위를 넓혔다 --
// 가입 요청 관리/MEMBER 관리는 canManageMembers, 단체 비활성화는
// canDeactivateOrganization이 각각 별도로 담당하므로(둘 다 여기 나열되어
// 있지 않음) 이 변경으로 다른 권한 판정은 전혀 영향받지 않는다.
export async function canManageOrganization(userId: number, organizationId: number): Promise<boolean> {
  const membership = await getMembership(userId, organizationId);
  return isAdminOrLeader(membership);
}

// 단체 명의로 게시글/댓글을 작성할 수 있는가 -- MEMBER/ADMIN/LEADER 누구나
// 가능하지만, 단체가 INACTIVE면 어떤 역할이어도 불가능하다 (탈퇴/비활성화된
// 단체 명의의 신규 활동을 막는 것이 canPostAsOrganization의 핵심 목적).
export async function canPostAsOrganization(userId: number, organizationId: number): Promise<boolean> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { status: true },
  });
  if (!organization || organization.status !== OrganizationStatus.ACTIVE) return false;

  const membership = await getMembership(userId, organizationId);
  return membership !== null;
}

// 가입 요청 승인/거절, MEMBER 강제 탈퇴 등 "구성원 관리" 일반 -- ADMIN 이상
// (ADMIN 또는 LEADER). 개별 대상에 대한 더 세밀한 제약(예: ADMIN이 다른
// ADMIN을 제거할 수 없음)은 canRemoveMember가 별도로 판단한다.
export async function canManageMembers(userId: number, organizationId: number): Promise<boolean> {
  const membership = await getMembership(userId, organizationId);
  return isAdminOrLeader(membership);
}

// ADMIN 임명은 LEADER만 가능 -- ADMIN이 다른 ADMIN을 임명하는 것은 기본적으로
// 제한한다는 Phase 12-1 §6/§18의 설계를 그대로 반영.
export async function canAppointAdmin(userId: number, organizationId: number): Promise<boolean> {
  const membership = await getMembership(userId, organizationId);
  return isLeader(membership);
}

// 특정 구성원(target)을 강제로 제거할 수 있는가 -- actor와 target 양쪽의
// 현재 역할을 모두 고려하는 유일한 helper. 규칙(Phase 12-1 §6/§18 권한
// 매트릭스 그대로):
//   - target이 LEADER면 이 경로로는 절대 제거 불가 (LEADER 강제 해임 자체가
//     없음 -- 반드시 transferLeadership으로 승계한 뒤에야 그 사람이 스스로
//     탈퇴할 수 있다).
//   - target이 ADMIN이면 actor가 LEADER일 때만 가능 (ADMIN이 다른 ADMIN을
//     해임하는 것은 불가).
//   - target이 MEMBER면 actor가 ADMIN 또는 LEADER면 가능.
// 자기 자신의 자발적 탈퇴(leaveOrganization)는 이 helper를 거치지 않는다 --
// "누가 남을 내보내는가"와 "본인이 스스로 나가는가"는 서로 다른 규칙이므로
// (예: ADMIN은 스스로는 언제든 탈퇴 가능하지만, canRemoveMember로는 LEADER
// 만이 ADMIN을 제거할 수 있음) organization/service.ts::leaveOrganization이
// 자체적으로 "마지막 LEADER가 아닌가"만 확인한다.
export async function canRemoveMember(
  userId: number,
  organizationId: number,
  targetUserId: number,
): Promise<boolean> {
  const [actor, target] = await Promise.all([
    getMembership(userId, organizationId),
    getMembership(targetUserId, organizationId),
  ]);
  if (!target) return false; // 대상이 이미 구성원이 아님
  if (target.role === OrganizationRole.LEADER) return false;
  if (target.role === OrganizationRole.ADMIN) return isLeader(actor);
  return isAdminOrLeader(actor);
}

// LEADER 승계(transferLeadership) 개시 권한 -- 현재 LEADER 본인만.
export async function canTransferLeadership(userId: number, organizationId: number): Promise<boolean> {
  const membership = await getMembership(userId, organizationId);
  return isLeader(membership);
}

// 단체 비활성화 -- LEADER, 또는 명시적으로 허용된 Platform Admin override.
// `isPlatformAdmin`은 호출부가 이미 확인한 `isAdmin(currentUser)` 결과를
// 그대로 넘겨받는다 (이 함수 스스로 User.isAdmin을 조회하지 않음 -- 그건
// @/lib/moderation/service의 몫이며, 여기서 다시 구현해 두 곳에 진실의
// 원천을 만들지 않는다).
export async function canDeactivateOrganization(
  userId: number,
  organizationId: number,
  isPlatformAdmin: boolean,
): Promise<boolean> {
  if (isPlatformAdmin) return true;
  const membership = await getMembership(userId, organizationId);
  return isLeader(membership);
}
