import { prisma } from "@/lib/db/prisma";
import {
  OrganizationRole as PrismaOrganizationRole,
  OrganizationStatus as PrismaOrganizationStatus,
  OrganizationRequestStatus as PrismaOrganizationRequestStatus,
  NotificationType as PrismaNotificationType,
  Prisma,
  type User,
} from "@/generated/prisma/client";
import { isAdmin } from "@/lib/moderation/service";
import {
  canAppointAdmin,
  canDeactivateOrganization,
  canManageMembers,
  canManageOrganization,
  canPostAsOrganization,
  canRemoveMember,
} from "./authz";
import type {
  ApproveOrganizationCreationRequestInput,
  CreateOrganizationCreationRequestInput,
  CreateOrganizationJoinRequestInput,
  OrganizationProfileUpdateInput,
  RejectOrganizationCreationRequestInput,
  ReviewOrganizationJoinRequestInput,
} from "./schema";

// Phase 12-2: DB/service layer only -- see the Phase 12-1 design report
// for the full rationale and prisma/schema.prisma's own model comments
// for why each FK/enum choice was made. No UI, no Server Action, no route
// calls into this module yet (that's Phase 12-3+); every function here is
// a plain async function returning a typed result, exactly like every
// other *.service.ts in this app (posts/service.ts, comment/service.ts,
// announcement/service.ts, feedback/service.ts) -- never redirects, never
// touches next/navigation or next/cache.

const ROLE_FROM_DB: Record<PrismaOrganizationRole, "leader" | "admin" | "member"> = {
  LEADER: "leader",
  ADMIN: "admin",
  MEMBER: "member",
};
const STATUS_FROM_DB: Record<PrismaOrganizationStatus, "active" | "inactive"> = {
  ACTIVE: "active",
  INACTIVE: "inactive",
};
const STATUS_TO_DB: Record<"active" | "inactive", PrismaOrganizationStatus> = {
  active: PrismaOrganizationStatus.ACTIVE,
  inactive: PrismaOrganizationStatus.INACTIVE,
};

export type OrganizationDTO = {
  id: number;
  name: string;
  description: string | null;
  organizationType: string;
  scope: string | null;
  contactEmail: string | null;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
};

export type OrganizationMemberDTO = {
  id: number;
  organizationId: number;
  role: "leader" | "admin" | "member";
  joinedAt: Date;
  user: { id: number; nickname: string | null; publicId: string };
};

// Phase 12-2: the shared result union every function in this module
// returns -- same "one wide union, not every kind applies to every
// function" convention moderation/service.ts's AdminMutationResult
// already establishes in this codebase.
export type OrganizationMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "already_member" }
  | { kind: "not_a_member" }
  | { kind: "inactive_organization" }
  | { kind: "duplicate_pending_request" }
  // 승인/거절 대상이 이미 PENDING이 아니거나(중복 처리), appoint/removeAdmin
  // 대상의 현재 role이 그 작업과 맞지 않는 경우(예: 이미 ADMIN인 사람을
  // appointAdmin, LEADER인 사람을 target으로 하는 등) 공통으로 쓰는 kind.
  | { kind: "invalid_state" }
  | { kind: "last_leader_cannot_leave" }
  | { kind: "target_not_active_member" };

function toOrganizationDTO(row: {
  id: number;
  name: string;
  description: string | null;
  organizationType: string;
  scope: string | null;
  contactEmail: string | null;
  status: PrismaOrganizationStatus;
  createdAt: Date;
  updatedAt: Date;
}): OrganizationDTO {
  return { ...row, status: STATUS_FROM_DB[row.status] };
}

function toMemberDTO(row: {
  id: number;
  organizationId: number;
  role: PrismaOrganizationRole;
  joinedAt: Date;
  user: { id: number; nickname: string | null; publicId: string };
}): OrganizationMemberDTO {
  return { id: row.id, organizationId: row.organizationId, role: ROLE_FROM_DB[row.role], joinedAt: row.joinedAt, user: row.user };
}

const MEMBER_SELECT = { user: { select: { id: true, nickname: true, publicId: true } } } as const;

// ---------- 기본 조회 (§13) ----------

export async function getOrganizationById(id: number): Promise<OrganizationDTO | null> {
  const row = await prisma.organization.findUnique({ where: { id } });
  return row ? toOrganizationDTO(row) : null;
}

// 비활성 단체는 제외 -- 공개 목록에는 ACTIVE만 노출한다. 이 phase엔 UI가
// 없어 실제로 호출되는 곳은 없지만, 다음 phase의 /organizations 목록
// 페이지가 그대로 쓸 수 있도록 지금 만들어 둔다. 페이지네이션 없이 방어적
// 상한만 둔다 -- posts/service.ts::listLostPostsByUser와 동일한 "내 것들
// 나열" 류의 관례(MY_POSTS_CAP)를 그대로 따름.
const ORGANIZATION_LIST_CAP = 200;

export async function listActiveOrganizations(): Promise<OrganizationDTO[]> {
  const rows = await prisma.organization.findMany({
    where: { status: PrismaOrganizationStatus.ACTIVE },
    orderBy: [{ name: "asc" }],
    take: ORGANIZATION_LIST_CAP,
  });
  return rows.map(toOrganizationDTO);
}

export async function getOrganizationMembers(organizationId: number): Promise<OrganizationMemberDTO[]> {
  const rows = await prisma.organizationMember.findMany({
    where: { organizationId },
    // OrganizationRole은 LEADER/ADMIN/MEMBER 순서로 선언되어 있어(schema.prisma)
    // Postgres enum의 기본 정렬 순서가 곧 선언 순서 -- "asc"만으로 LEADER가
    // 항상 먼저 온다.
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    include: MEMBER_SELECT,
  });
  return rows.map(toMemberDTO);
}

export async function getOrganizationMember(organizationId: number, userId: number): Promise<OrganizationMemberDTO | null> {
  const row = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: MEMBER_SELECT,
  });
  return row ? toMemberDTO(row) : null;
}

export async function isOrganizationMember(organizationId: number, userId: number): Promise<boolean> {
  const row = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { id: true },
  });
  return row !== null;
}

export async function getOrganizationRole(organizationId: number, userId: number): Promise<"leader" | "admin" | "member" | null> {
  const row = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true },
  });
  return row ? ROLE_FROM_DB[row.role] : null;
}

export type OrganizationPostingCheck =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "inactive_organization" }
  | { kind: "forbidden" };

// Phase 12-5 §6/§8: the single entry point posts/aiService.ts and
// comment/service.ts both call before ever writing a client-supplied
// organizationId into a LostPost/FoundPost/Comment row. Distinguishes
// not_found from inactive_organization from forbidden (a plain boolean
// like canPostAsOrganization's own return type can't tell those apart),
// while still deferring the actual membership/ACTIVE re-check to
// canPostAsOrganization itself -- never duplicating that logic, only
// wrapping it with a distinguishable result. organizationId === null is
// deliberately not handled here -- that's "personal post", decided by the
// caller before ever reaching this function (see this phase's own spec §7).
export async function validateOrganizationPosting(userId: number, organizationId: number): Promise<OrganizationPostingCheck> {
  const organization = await getOrganizationById(organizationId);
  if (!organization) return { kind: "not_found" };
  if (organization.status !== "active") return { kind: "inactive_organization" };

  const allowed = await canPostAsOrganization(userId, organizationId);
  if (!allowed) return { kind: "forbidden" };

  return { kind: "ok" };
}

export type MyOrganizationMembershipDTO = {
  organizationId: number;
  organizationName: string;
  organizationStatus: "active" | "inactive";
  role: "leader" | "admin" | "member";
};

// Phase 12-4 §23: /me의 "내 단체" 섹션 전용 -- 개인 인증 정보는 전혀 포함하지
// 않고(§25), 본인이 이미 알고 있는 자기 자신의 소속 정보만 반환한다.
export async function getMyOrganizationMemberships(userId: number): Promise<MyOrganizationMembershipDTO[]> {
  const rows = await prisma.organizationMember.findMany({
    where: { userId },
    include: { organization: { select: { id: true, name: true, status: true } } },
    orderBy: { joinedAt: "desc" },
  });
  return rows.map((row) => ({
    organizationId: row.organization.id,
    organizationName: row.organization.name,
    organizationStatus: STATUS_FROM_DB[row.organization.status],
    role: ROLE_FROM_DB[row.role],
  }));
}

// Phase 12-4 §9: 단체 프로필 페이지가 "가입 신청 처리 중" 상태를 보여주기
// 위해 현재 사용자의 PENDING 가입 신청 존재 여부만 확인한다 (메시지/사유 등
// 다른 신청자에게 노출되면 안 되는 필드는 select하지 않음).
export async function getMyPendingJoinRequest(organizationId: number, userId: number): Promise<{ id: number } | null> {
  return prisma.organizationJoinRequest.findFirst({
    where: { organizationId, userId, status: PrismaOrganizationRequestStatus.PENDING },
    select: { id: true },
  });
}

// ---------- Organization 생성 (§14) ----------

type CreateOrganizationInput = {
  name: string;
  organizationType: string;
  scope?: string;
  contactEmail?: string;
  description?: string;
};

// tx를 받는 내부 헬퍼 -- createOrganization()과
// approveOrganizationCreationRequest() 양쪽에서 재사용하되, 각자 자기 자신의
// prisma.$transaction 경계 안에서 호출한다(Prisma interactive transaction은
// 중첩을 지원하지 않으므로, 이 헬퍼 자체는 트랜잭션을 열지 않는다).
async function insertOrganizationWithLeader(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  input: CreateOrganizationInput,
  leaderUserId: number,
) {
  const organization = await tx.organization.create({
    data: {
      name: input.name,
      organizationType: input.organizationType,
      scope: input.scope,
      contactEmail: input.contactEmail,
      description: input.description,
    },
  });
  await tx.organizationMember.create({
    data: { organizationId: organization.id, userId: leaderUserId, role: PrismaOrganizationRole.LEADER },
  });
  return organization;
}

// 내부 전용 -- 일반 사용자가 직접 호출하는 public action이 아니다. 오직
// approveOrganizationCreationRequest()의 승인 workflow에서만 실질적으로
// 쓰이며(그 함수는 이 헬퍼를 직접 호출하지 않고 자기 트랜잭션 안에서
// insertOrganizationWithLeader를 재사용한다 -- 아래 참조), 여기서는 독립
// 호출/단위 테스트 목적의 표준 진입점만 제공한다. 호출자의 권한 검증은
// 이 함수의 책임이 아니다(호출부, 즉 승인 workflow가 이미
// isAdmin(admin)을 확인한 뒤에만 여기 도달한다).
export async function createOrganization(input: CreateOrganizationInput, leaderUserId: number): Promise<OrganizationDTO> {
  const organization = await prisma.$transaction((tx) => insertOrganizationWithLeader(tx, input, leaderUserId));
  return toOrganizationDTO(organization);
}

// ---------- Organization 정보 수정 (Phase 12-4 §11) ----------

// ADMIN 이상(canManageOrganization -- Phase 12-4에서 ADMIN까지 넓어짐, 그
// 함수 자신의 코멘트 참조). OrganizationStatus는 여기서 절대 바꾸지 않는다
// -- 활성화/비활성화는 deactivateOrganization()만의 책임(§22).
export async function updateOrganizationProfile(
  actorUserId: number,
  organizationId: number,
  input: OrganizationProfileUpdateInput,
): Promise<OrganizationMutationResult<OrganizationDTO>> {
  if (!(await canManageOrganization(actorUserId, organizationId))) return { kind: "forbidden" };

  const existing = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!existing) return { kind: "not_found" };

  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data: {
      name: input.name,
      organizationType: input.organizationType,
      description: input.description || null,
      scope: input.scope || null,
      // 빈 문자열("")은 "값을 비운다"는 뜻으로 취급한다 -- Organization.
      // contactEmail은 nullable이고, 폼에서 빈 칸으로 제출하는 것과
      // 실제로 null을 의도하는 것을 구분할 이유가 없다(생성 요청과 달리
      // 기존 단체의 연락 이메일은 선택 필드).
      contactEmail: input.contactEmail || null,
    },
  });

  return { kind: "ok", data: toOrganizationDTO(updated) };
}

// ---------- Organization Creation Request (§15) ----------

export type OrganizationCreationRequestDTO = {
  id: number;
  organizationName: string;
  organizationType: string;
  scope: string | null;
  contactEmail: string;
  purpose: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  rejectionReason: string | null;
  adminNote: string | null;
  reviewedAt: Date | null;
  resultingOrganizationId: number | null;
  createdAt: Date;
};

// Phase 12-3: admin-only 목록/상세에서 신청자 정보를 함께 보여주기 위한 확장
// DTO -- OrganizationCreationRequestDTO에 requester(닉네임/publicId)를 더한다.
// 일반 사용자에게는(자기 자신의 신청이라도) 이 확장 필드를 노출하지 않는다
// -- feedback/service.ts의 FeedbackDTO(사용자용) vs FeedbackAdminDTO(관리자용)
// 분리와 동일한 원칙.
export type OrganizationCreationRequestAdminDTO = OrganizationCreationRequestDTO & {
  requester: { id: number; nickname: string | null; publicId: string };
  reviewedBy: { id: number; nickname: string | null; publicId: string } | null;
};

const REQUEST_STATUS_FROM_DB: Record<PrismaOrganizationRequestStatus, "pending" | "approved" | "rejected" | "cancelled"> = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
};
const REQUEST_STATUS_TO_DB: Record<"pending" | "approved" | "rejected" | "cancelled", PrismaOrganizationRequestStatus> = {
  pending: PrismaOrganizationRequestStatus.PENDING,
  approved: PrismaOrganizationRequestStatus.APPROVED,
  rejected: PrismaOrganizationRequestStatus.REJECTED,
  cancelled: PrismaOrganizationRequestStatus.CANCELLED,
};

function toCreationRequestDTO(row: {
  id: number;
  organizationName: string;
  organizationType: string;
  scope: string | null;
  contactEmail: string;
  purpose: string;
  status: PrismaOrganizationRequestStatus;
  rejectionReason: string | null;
  adminNote: string | null;
  reviewedAt: Date | null;
  resultingOrganizationId: number | null;
  createdAt: Date;
}): OrganizationCreationRequestDTO {
  return {
    id: row.id,
    organizationName: row.organizationName,
    organizationType: row.organizationType,
    scope: row.scope,
    contactEmail: row.contactEmail,
    purpose: row.purpose,
    status: REQUEST_STATUS_FROM_DB[row.status],
    rejectionReason: row.rejectionReason,
    adminNote: row.adminNote,
    reviewedAt: row.reviewedAt,
    resultingOrganizationId: row.resultingOrganizationId,
    createdAt: row.createdAt,
  };
}

const CREATION_REQUEST_ADMIN_INCLUDE = {
  requestedBy: { select: { id: true, nickname: true, publicId: true } },
  reviewedBy: { select: { id: true, nickname: true, publicId: true } },
} as const;

function toCreationRequestAdminDTO(
  row: Parameters<typeof toCreationRequestDTO>[0] & {
    requestedBy: { id: number; nickname: string | null; publicId: string };
    reviewedBy: { id: number; nickname: string | null; publicId: string } | null;
  },
): OrganizationCreationRequestAdminDTO {
  return { ...toCreationRequestDTO(row), requester: row.requestedBy, reviewedBy: row.reviewedBy };
}

export async function createOrganizationCreationRequest(
  user: User,
  input: CreateOrganizationCreationRequestInput,
): Promise<OrganizationMutationResult<{ id: number }>> {
  // Phase 12-3 §6: 이미 PENDING 신청이 있으면 새 신청을 만들 수 없다 --
  // APPROVED/REJECTED/CANCELLED된 신청은 막지 않는다(재신청 허용).
  const existingPending = await prisma.organizationCreationRequest.findFirst({
    where: { requestedByUserId: user.id, status: PrismaOrganizationRequestStatus.PENDING },
    select: { id: true },
  });
  if (existingPending) return { kind: "duplicate_pending_request" };

  const created = await prisma.organizationCreationRequest.create({
    data: {
      requestedByUserId: user.id,
      organizationName: input.organizationName,
      organizationType: input.organizationType,
      scope: input.scope,
      contactEmail: input.contactEmail,
      purpose: input.purpose,
    },
  });
  return { kind: "ok", data: { id: created.id } };
}

// 이 사용자의 현재 PENDING 신청 -- /organizations/create 페이지가 폼을
// 보여줄지, 이미 대기 중인 신청 상태(+ 취소 버튼)를 보여줄지 결정하는 데
// 쓰인다. 여러 개의 PENDING 신청은 위 duplicate 체크로 애초에 존재할 수
// 없으므로 최대 1건이다.
export async function getMyPendingOrganizationCreationRequest(userId: number): Promise<OrganizationCreationRequestDTO | null> {
  const row = await prisma.organizationCreationRequest.findFirst({
    where: { requestedByUserId: userId, status: PrismaOrganizationRequestStatus.PENDING },
    orderBy: { createdAt: "desc" },
  });
  return row ? toCreationRequestDTO(row) : null;
}

export async function cancelOrganizationCreationRequest(
  userId: number,
  requestId: number,
): Promise<OrganizationMutationResult<{ id: number }>> {
  const existing = await prisma.organizationCreationRequest.findUnique({ where: { id: requestId } });
  if (!existing) return { kind: "not_found" };
  if (existing.requestedByUserId !== userId) return { kind: "forbidden" };

  const result = await prisma.organizationCreationRequest.updateMany({
    where: { id: requestId, status: PrismaOrganizationRequestStatus.PENDING },
    data: { status: PrismaOrganizationRequestStatus.CANCELLED },
  });
  if (result.count === 0) return { kind: "invalid_state" };
  return { kind: "ok", data: { id: requestId } };
}

// Platform Admin 전용. `updateMany({where:{...,status:PENDING}})`로 승인을
// "선점"하는 것 자체가 동시 이중 승인을 막는 원자적 체크다 -- withdrawUser()/
// recordPrivacyConsent()가 이미 쓰는 "only if still in the expected state"
// 패턴과 동일.
export async function approveOrganizationCreationRequest(
  admin: User,
  requestId: number,
  input?: ApproveOrganizationCreationRequestInput,
): Promise<OrganizationMutationResult<{ organizationId: number }>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const existing = await prisma.organizationCreationRequest.findUnique({ where: { id: requestId } });
  if (!existing) return { kind: "not_found" };

  const organization = await prisma.$transaction(async (tx) => {
    const claimed = await tx.organizationCreationRequest.updateMany({
      where: { id: requestId, status: PrismaOrganizationRequestStatus.PENDING },
      data: {
        status: PrismaOrganizationRequestStatus.APPROVED,
        reviewedByUserId: admin.id,
        reviewedAt: new Date(),
        ...(input?.adminNote !== undefined ? { adminNote: input.adminNote || null } : {}),
      },
    });
    if (claimed.count === 0) return null; // 이미 처리됨(동시 요청 등)

    const org = await insertOrganizationWithLeader(
      tx,
      {
        name: existing.organizationName,
        organizationType: existing.organizationType,
        scope: existing.scope ?? undefined,
        contactEmail: existing.contactEmail,
      },
      existing.requestedByUserId,
    );

    await tx.organizationCreationRequest.update({
      where: { id: requestId },
      data: { resultingOrganizationId: org.id },
    });

    // Phase 12-3 §13: 신청자 1명에게만 알림 -- fan-out 아님. 같은 트랜잭션
    // 안에서 생성해 승인이 커밋됐는데 알림만 빠지는(또는 그 반대) 상황이
    // 없도록 한다. notification/service.ts 자체는 알림을 생성하지 않는다는
    // 그 모듈 자신의 설계 원칙("creation stays inside the transaction of
    // whichever domain caused it")을 그대로 따른다.
    await tx.notification.create({
      data: {
        userId: existing.requestedByUserId,
        type: PrismaNotificationType.ORGANIZATION_REQUEST_PROCESSED,
        title: "단체 생성 신청이 승인되었습니다",
        content: `"${existing.organizationName}" 단체 생성 신청이 승인되어 단체가 생성되었습니다. 단체의 대표 관리자로 등록되었습니다.`,
        relatedType: "organization_creation_request",
        relatedId: requestId,
      },
    });

    return org;
  });

  if (!organization) return { kind: "invalid_state" };
  return { kind: "ok", data: { organizationId: organization.id } };
}

export async function rejectOrganizationCreationRequest(
  admin: User,
  requestId: number,
  input: RejectOrganizationCreationRequestInput,
): Promise<OrganizationMutationResult<{ id: number }>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const existing = await prisma.organizationCreationRequest.findUnique({ where: { id: requestId } });
  if (!existing) return { kind: "not_found" };

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.organizationCreationRequest.updateMany({
      where: { id: requestId, status: PrismaOrganizationRequestStatus.PENDING },
      data: {
        status: PrismaOrganizationRequestStatus.REJECTED,
        reviewedByUserId: admin.id,
        reviewedAt: new Date(),
        rejectionReason: input.rejectionReason,
        ...(input.adminNote !== undefined ? { adminNote: input.adminNote || null } : {}),
      },
    });
    if (claimed.count === 0) return claimed;

    await tx.notification.create({
      data: {
        userId: existing.requestedByUserId,
        type: PrismaNotificationType.ORGANIZATION_REQUEST_PROCESSED,
        title: "단체 생성 신청이 거절되었습니다",
        content: `"${existing.organizationName}" 단체 생성 신청이 거절되었습니다. 사유: ${input.rejectionReason}`,
        relatedType: "organization_creation_request",
        relatedId: requestId,
      },
    });

    return claimed;
  });
  if (result.count === 0) return { kind: "invalid_state" };
  return { kind: "ok", data: { id: requestId } };
}

export type PagedOrganizationCreationRequests = {
  items: OrganizationCreationRequestAdminDTO[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// Platform Admin 전용 -- admin/organization-requests 목록 페이지. status
// 필터는 선택(생략 시 전체), 최신 신청 우선. 다른 admin list 함수들
// (listReportsForAdmin, listFeedbackForAdmin)과 동일한 페이지네이션 형태.
export async function listOrganizationCreationRequestsForAdmin(
  admin: User,
  { status, page, limit }: { status?: "pending" | "approved" | "rejected" | "cancelled"; page: number; limit: number },
): Promise<OrganizationMutationResult<PagedOrganizationCreationRequests>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const where = status ? { status: REQUEST_STATUS_TO_DB[status] } : {};
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.organizationCreationRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
      include: CREATION_REQUEST_ADMIN_INCLUDE,
    }),
    prisma.organizationCreationRequest.count({ where }),
  ]);

  return {
    kind: "ok",
    data: {
      items: rows.map(toCreationRequestAdminDTO),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

// Platform Admin 전용 -- admin/organization-requests/[id] 상세 페이지.
export async function getOrganizationCreationRequestForAdmin(
  admin: User,
  id: number,
): Promise<OrganizationMutationResult<OrganizationCreationRequestAdminDTO>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const row = await prisma.organizationCreationRequest.findUnique({
    where: { id },
    include: CREATION_REQUEST_ADMIN_INCLUDE,
  });
  if (!row) return { kind: "not_found" };

  return { kind: "ok", data: toCreationRequestAdminDTO(row) };
}

// ---------- Join Request (§16) ----------

export async function createJoinRequest(
  userId: number,
  organizationId: number,
  input: CreateOrganizationJoinRequestInput,
): Promise<OrganizationMutationResult<{ id: number }>> {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { status: true } });
  if (!organization) return { kind: "not_found" };
  if (organization.status !== PrismaOrganizationStatus.ACTIVE) return { kind: "inactive_organization" };

  const existingMembership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (existingMembership) return { kind: "already_member" };

  // Fast-path pre-check; the real backstop is the partial unique index
  // (idx_org_join_request_pending_unique, see this phase's own migration)
  // for the rare simultaneous-double-request race this check alone can't
  // close.
  const existingPending = await prisma.organizationJoinRequest.findFirst({
    where: { organizationId, userId, status: PrismaOrganizationRequestStatus.PENDING },
    select: { id: true },
  });
  if (existingPending) return { kind: "duplicate_pending_request" };

  // Phase 12-4 §8: the pre-check above closes the common case, but not a
  // genuinely simultaneous double-request (two calls both pass the
  // pre-check before either commits) -- idx_org_join_request_pending_unique
  // (the partial unique index from Phase 12-2's own migration) is what
  // actually stops that at the DB level. Postgres reports this as a plain
  // unique_violation regardless of whether the index was declared through
  // Prisma's schema DSL, and Prisma's driver surfaces that as P2002 either
  // way -- same catch shape this codebase already uses for a real @unique
  // constraint (see chat/service.ts::getOrCreateDirectChatRoom). Converts
  // it to the same typed result the pre-check above already returns, never
  // a raw Prisma error reaching the caller.
  try {
    const created = await prisma.organizationJoinRequest.create({
      data: { organizationId, userId, message: input.message },
    });
    return { kind: "ok", data: { id: created.id } };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { kind: "duplicate_pending_request" };
    }
    throw error;
  }
}

export type OrganizationJoinRequestDTO = {
  id: number;
  organizationId: number;
  message: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  rejectionReason: string | null;
  createdAt: Date;
  requester: { id: number; nickname: string | null; publicId: string };
};

function toJoinRequestDTO(row: {
  id: number;
  organizationId: number;
  message: string | null;
  status: PrismaOrganizationRequestStatus;
  rejectionReason: string | null;
  createdAt: Date;
  user: { id: number; nickname: string | null; publicId: string };
}): OrganizationJoinRequestDTO {
  return {
    id: row.id,
    organizationId: row.organizationId,
    message: row.message,
    status: REQUEST_STATUS_FROM_DB[row.status],
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt,
    requester: row.user,
  };
}

const JOIN_REQUEST_LIST_CAP = 200;

// Phase 12-4 §12: 설정 페이지의 "가입 신청 큐" -- ADMIN 이상만 조회 가능
// (canManageMembers, 승인/거절과 동일한 게이트). 신청자의 닉네임/publicId만
// 포함하고 이메일 등 인증 정보는 절대 select하지 않는다(§25).
export async function listJoinRequestsForOrganization(
  actorUserId: number,
  organizationId: number,
): Promise<OrganizationMutationResult<OrganizationJoinRequestDTO[]>> {
  if (!(await canManageMembers(actorUserId, organizationId))) return { kind: "forbidden" };

  const rows = await prisma.organizationJoinRequest.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "desc" }],
    take: JOIN_REQUEST_LIST_CAP,
    include: { user: { select: { id: true, nickname: true, publicId: true } } },
  });
  return { kind: "ok", data: rows.map(toJoinRequestDTO) };
}

export type MyOrganizationJoinRequestDTO = {
  id: number;
  organizationId: number;
  organizationName: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  rejectionReason: string | null;
  createdAt: Date;
};

// Phase 12-10 §5: 단체 허브의 "신청 내역" 탭 전용 -- 본인이 낸 가입 신청
// 전체(모든 상태, 여러 단체에 걸쳐)를 한 번에 보여준다. listJoinRequestsForOrganization
// (관리자용, 한 단체 안의 모든 신청자)과는 반대 방향의 조회라 신청자 자신의
// 정보(requester)는 필요 없고, 대신 어느 단체에 낸 신청인지(organizationName)가
// 필요하다는 점만 다르다 -- 그래서 별도 DTO/함수로 분리했다(§25: 다른
// 신청자의 정보는 이 함수 어디에서도 select하지 않는다).
export async function getMyOrganizationJoinRequests(userId: number): Promise<MyOrganizationJoinRequestDTO[]> {
  const rows = await prisma.organizationJoinRequest.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }],
    take: JOIN_REQUEST_LIST_CAP,
    include: { organization: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    organizationName: row.organization.name,
    status: REQUEST_STATUS_FROM_DB[row.status],
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt,
  }));
}

export async function cancelJoinRequest(userId: number, requestId: number): Promise<OrganizationMutationResult<{ id: number }>> {
  const existing = await prisma.organizationJoinRequest.findUnique({ where: { id: requestId } });
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden" };

  const result = await prisma.organizationJoinRequest.updateMany({
    where: { id: requestId, status: PrismaOrganizationRequestStatus.PENDING },
    data: { status: PrismaOrganizationRequestStatus.CANCELLED },
  });
  if (result.count === 0) return { kind: "invalid_state" };
  return { kind: "ok", data: { id: requestId } };
}

// actorUserId는 그 단체의 LEADER/ADMIN이어야 한다 (canManageMembers) --
// Platform Admin이라고 자동으로 승인 권한을 갖지 않는다(Phase 12-1 §3의
// "Platform Admin ≠ Organization Leader" 원칙).
export async function approveJoinRequest(
  actorUserId: number,
  requestId: number,
): Promise<OrganizationMutationResult<{ id: number }>> {
  const existing = await prisma.organizationJoinRequest.findUnique({
    where: { id: requestId },
    include: { organization: { select: { name: true } } },
  });
  if (!existing) return { kind: "not_found" };
  if (!(await canManageMembers(actorUserId, existing.organizationId))) return { kind: "forbidden" };

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.organizationJoinRequest.updateMany({
      where: { id: requestId, status: PrismaOrganizationRequestStatus.PENDING },
      data: { status: PrismaOrganizationRequestStatus.APPROVED, reviewedByUserId: actorUserId, reviewedAt: new Date() },
    });
    if (claimed.count === 0) return null;

    // 승인 처리 중 이미 다른 경로로 멤버가 되어 있을 수 있는 극단적 경우
    // (레이스) 대비 -- 중복 멤버십 생성을 시도하지 않는다.
    const alreadyMember = await tx.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: existing.organizationId, userId: existing.userId } },
    });
    if (!alreadyMember) {
      await tx.organizationMember.create({
        data: { organizationId: existing.organizationId, userId: existing.userId, role: PrismaOrganizationRole.MEMBER },
      });
    }

    // Phase 12-4 §28: 가입 신청자 1명에게만, 같은 트랜잭션 안에서. 새
    // NotificationType을 추가하지 않고 Phase 12-3의
    // ORGANIZATION_REQUEST_PROCESSED를 그대로 재사용하되, relatedType은
    // "organization"(단체 자체를 가리킴 -- 승인 후에는 /organizations/[id]
    // 로 안내하는 것이 join 신청 자체보다 더 유용하므로, creation request
    // 알림이 쓰는 "organization_creation_request"와는 다른 값을 쓴다).
    await tx.notification.create({
      data: {
        userId: existing.userId,
        type: PrismaNotificationType.ORGANIZATION_REQUEST_PROCESSED,
        title: "단체 가입 신청이 승인되었습니다",
        content: `"${existing.organization.name}" 단체 가입 신청이 승인되었습니다.`,
        relatedType: "organization",
        relatedId: existing.organizationId,
      },
    });

    return true;
  });

  if (!result) return { kind: "invalid_state" };
  return { kind: "ok", data: { id: requestId } };
}

export async function rejectJoinRequest(
  actorUserId: number,
  requestId: number,
  input: ReviewOrganizationJoinRequestInput,
): Promise<OrganizationMutationResult<{ id: number }>> {
  const existing = await prisma.organizationJoinRequest.findUnique({
    where: { id: requestId },
    include: { organization: { select: { name: true } } },
  });
  if (!existing) return { kind: "not_found" };
  if (!(await canManageMembers(actorUserId, existing.organizationId))) return { kind: "forbidden" };

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.organizationJoinRequest.updateMany({
      where: { id: requestId, status: PrismaOrganizationRequestStatus.PENDING },
      data: {
        status: PrismaOrganizationRequestStatus.REJECTED,
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
        rejectionReason: input.rejectionReason,
      },
    });
    if (claimed.count === 0) return claimed;

    await tx.notification.create({
      data: {
        userId: existing.userId,
        type: PrismaNotificationType.ORGANIZATION_REQUEST_PROCESSED,
        title: "단체 가입 신청이 거절되었습니다",
        content: input.rejectionReason
          ? `"${existing.organization.name}" 단체 가입 신청이 거절되었습니다. 사유: ${input.rejectionReason}`
          : `"${existing.organization.name}" 단체 가입 신청이 거절되었습니다.`,
        relatedType: "organization",
        relatedId: existing.organizationId,
      },
    });

    return claimed;
  });
  if (result.count === 0) return { kind: "invalid_state" };
  return { kind: "ok", data: { id: requestId } };
}

// ---------- 구성원 관리 ----------

// LEADER 전용 (canAppointAdmin) -- target은 현재 MEMBER여야 한다.
export async function appointAdmin(
  actorUserId: number,
  organizationId: number,
  targetUserId: number,
): Promise<OrganizationMutationResult<OrganizationMemberDTO>> {
  if (!(await canAppointAdmin(actorUserId, organizationId))) return { kind: "forbidden" };

  const target = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: targetUserId } },
  });
  if (!target) return { kind: "target_not_active_member" };
  if (target.role !== PrismaOrganizationRole.MEMBER) return { kind: "invalid_state" };

  const updated = await prisma.organizationMember.update({
    where: { id: target.id },
    data: { role: PrismaOrganizationRole.ADMIN },
    include: MEMBER_SELECT,
  });
  return { kind: "ok", data: toMemberDTO(updated) };
}

// ADMIN → MEMBER로 강등("해임") -- LEADER 전용, appointAdmin과 동일한 게이트.
export async function removeAdmin(
  actorUserId: number,
  organizationId: number,
  targetUserId: number,
): Promise<OrganizationMutationResult<OrganizationMemberDTO>> {
  if (!(await canAppointAdmin(actorUserId, organizationId))) return { kind: "forbidden" };

  const target = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: targetUserId } },
  });
  if (!target) return { kind: "target_not_active_member" };
  if (target.role !== PrismaOrganizationRole.ADMIN) return { kind: "invalid_state" };

  const updated = await prisma.organizationMember.update({
    where: { id: target.id },
    data: { role: PrismaOrganizationRole.MEMBER },
    include: MEMBER_SELECT,
  });
  return { kind: "ok", data: toMemberDTO(updated) };
}

// 강제 제거(누군가 다른 구성원을 내보냄) -- canRemoveMember의 actor/target
// 역할 조합 규칙을 그대로 따른다. 본인 스스로 나가는 것은 leaveOrganization()
// 이 별도로 처리한다(아래).
export async function removeMember(
  actorUserId: number,
  organizationId: number,
  targetUserId: number,
): Promise<OrganizationMutationResult<{ id: number }>> {
  if (!(await canRemoveMember(actorUserId, organizationId, targetUserId))) return { kind: "forbidden" };

  const target = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: targetUserId } },
  });
  if (!target) return { kind: "not_found" };

  await prisma.organizationMember.delete({ where: { id: target.id } });
  return { kind: "ok", data: { id: targetUserId } };
}

// 본인 자발적 탈퇴. §19/§20: 마지막 LEADER는 차단하며, 이 판정과 실제 삭제가
// 하나의 트랜잭션 안에서 이 단체의 LEADER 행들을 `SELECT ... FOR UPDATE`로
// 잠근 뒤 이뤄진다 -- 동시에 두 개의 leave/remove/transferLeadership 요청이
// 들어와도(§20의 race condition 요구사항) 하나가 커밋될 때까지 다른 하나는
// 잠금 해제를 기다리므로, "LEADER 0명" 상태가 절대 성립하지 않는다.
//
// 단순 count-then-delete(트랜잭션 격리 수준만 믿는 방식)는 PostgreSQL의
// 기본 READ COMMITTED에서 두 트랜잭션이 서로의 커밋 전 상태를 보지 못해
// 둘 다 동시에 "안전하다"고 판단할 수 있는 TOCTOU 레이스가 실제로 존재해서
// 택하지 않았다. 이 프로젝트 환경(PostgreSQL + Prisma)에서 전체를
// SERIALIZABLE로 바꾸는 것은 재시도 로직까지 필요해 과한 반면, 이 임계
// 구간만 행 잠금으로 직렬화하는 것이 가장 단순하고 안전한 선택이다.
export async function leaveOrganization(
  userId: number,
  organizationId: number,
): Promise<OrganizationMutationResult<{ id: number }>> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "OrganizationMember"
      WHERE organization_id = ${organizationId} AND role = 'leader'
      FOR UPDATE
    `;

    const membership = await tx.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (!membership) return { kind: "not_a_member" };

    if (membership.role === PrismaOrganizationRole.LEADER) {
      const leaderCount = await tx.organizationMember.count({
        where: { organizationId, role: PrismaOrganizationRole.LEADER },
      });
      if (leaderCount <= 1) return { kind: "last_leader_cannot_leave" };
    }

    await tx.organizationMember.delete({ where: { id: membership.id } });
    return { kind: "ok", data: { id: userId } };
  });
}

// ---------- Leadership transfer (§21) ----------

// LEADER 전용, target은 반드시 현재 ACTIVE 멤버(어떤 role이든)여야 하며
// 본인일 수 없다. leaveOrganization과 동일한 SELECT ... FOR UPDATE 잠금을
// 공유하는 이유: 두 작업 모두 "이 단체의 LEADER 구성"을 바꾸므로, 하나가
// 진행 중일 때 다른 하나가 끼어들어 일시적으로라도 불변식이 깨지는 순서로
// 커밋되는 것을 막아야 한다.
export async function transferLeadership(
  organizationId: number,
  currentLeaderUserId: number,
  targetUserId: number,
): Promise<OrganizationMutationResult<{ id: number }>> {
  if (currentLeaderUserId === targetUserId) return { kind: "invalid_state" };

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "OrganizationMember"
      WHERE organization_id = ${organizationId} AND role = 'leader'
      FOR UPDATE
    `;

    const current = await tx.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: currentLeaderUserId } },
    });
    if (!current || current.role !== PrismaOrganizationRole.LEADER) return { kind: "forbidden" };

    const target = await tx.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
    });
    if (!target) return { kind: "target_not_active_member" };

    await tx.organizationMember.update({ where: { id: target.id }, data: { role: PrismaOrganizationRole.LEADER } });
    await tx.organizationMember.update({ where: { id: current.id }, data: { role: PrismaOrganizationRole.ADMIN } });

    return { kind: "ok", data: { id: targetUserId } };
  });
}

// ---------- Organization deactivation (§22) ----------

export async function deactivateOrganization(
  actorUserId: number,
  organizationId: number,
  isPlatformAdmin: boolean,
): Promise<OrganizationMutationResult<{ id: number }>> {
  if (!(await canDeactivateOrganization(actorUserId, organizationId, isPlatformAdmin))) return { kind: "forbidden" };

  const result = await prisma.organization.updateMany({
    where: { id: organizationId, status: PrismaOrganizationStatus.ACTIVE },
    data: { status: PrismaOrganizationStatus.INACTIVE },
  });
  if (result.count === 0) {
    const existing = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    return existing ? { kind: "invalid_state" } : { kind: "not_found" };
  }
  return { kind: "ok", data: { id: organizationId } };
}

// ---------- Platform Admin (Phase 12-6) ----------
// 이 섹션의 모든 함수는 Platform Admin(User.isAdmin) 전용이다 -- Organization
// LEADER/ADMIN 여부와는 완전히 별개의 축(Phase 12-1 §3 "Platform Admin ≠
// Organization Leader" 원칙 그대로)이며, 매 호출마다 `isAdmin(admin)`을
// 다시 확인한다(다른 admin 전용 함수들 -- listOrganizationCreationRequestsForAdmin
// 등 -- 과 동일한 관례).

export type OrganizationAdminListItemDTO = OrganizationDTO & {
  memberCount: number;
  leader: { id: number; nickname: string | null; publicId: string } | null;
};

export type PagedOrganizationsForAdmin = {
  items: OrganizationAdminListItemDTO[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// /admin/organizations 목록 -- status 필터는 선택(생략 시 전체 -- §13:
// "기본값은 ACTIVE가 아니라 ALL"), 이름 부분 검색도 선택. 구성원 수 +
// LEADER 닉네임을 하나의 쿼리에서 함께 가져와(Prisma의 _count + 필터된
// relation include) 목록 한 줄당 별도 쿼리가 발생하지 않도록 한다(N+1 방지,
// §12의 명시적 요구).
export async function listOrganizationsForAdmin(
  admin: User,
  { status, q, page, limit }: { status?: "active" | "inactive"; q?: string; page: number; limit: number },
): Promise<OrganizationMutationResult<PagedOrganizationsForAdmin>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const where = {
    ...(status && { status: STATUS_TO_DB[status] }),
    ...(q && { name: { contains: q, mode: "insensitive" as const } }),
  };
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
      include: {
        _count: { select: { members: true } },
        // 정확히 LEADER 한 명만 존재해야 한다는 불변식(Phase 12-2 §20의
        // FOR UPDATE 잠금이 보장)을 그대로 신뢰 -- take: 1로 방어적 상한만
        // 둔다.
        members: {
          where: { role: PrismaOrganizationRole.LEADER },
          take: 1,
          select: { user: { select: { id: true, nickname: true, publicId: true } } },
        },
      },
    }),
    prisma.organization.count({ where }),
  ]);

  return {
    kind: "ok",
    data: {
      items: rows.map((row) => ({
        ...toOrganizationDTO(row),
        memberCount: row._count.members,
        leader: row.members[0]?.user ?? null,
      })),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export type OrganizationAdminDetailDTO = OrganizationDTO & {
  members: OrganizationMemberDTO[];
};

// /admin/organizations/[id] 상세 -- 이미 존재하는 getOrganizationById +
// getOrganizationMembers를 그대로 재사용(§12: "이미 존재하는 service가
// 충분하면 중복 함수를 만들지 않는다")하고, isAdmin 게이트만 얹는다.
export async function getOrganizationForAdmin(
  admin: User,
  id: number,
): Promise<OrganizationMutationResult<OrganizationAdminDetailDTO>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const organization = await getOrganizationById(id);
  if (!organization) return { kind: "not_found" };

  const members = await getOrganizationMembers(id);
  return { kind: "ok", data: { ...organization, members } };
}

// Platform Admin 전용 상태 전환 -- ACTIVE ↔ INACTIVE 양방향. 기존
// deactivateOrganization()(LEADER 또는 Platform Admin override, ACTIVE→
// INACTIVE 단방향)과는 의도적으로 분리된 별도 함수다: 이 함수는 재활성화
// (INACTIVE→ACTIVE, LEADER에게는 애초에 허용되지 않는 동작 -- Phase 12-4가
// 남겨둔 "LEADER가 비활성화하면 스스로 되돌릴 수 없다"는 gap을 Platform
// Admin만 메꾼다)까지 다루므로, canDeactivateOrganization()의 "LEADER 또는
// override" 의미를 재활용하면 오히려 "LEADER도 재활성화할 수 있다"는 잘못된
// 인상을 줄 수 있다 -- 그래서 이 함수는 처음부터 isAdmin(admin) 하나만
// 확인한다.
//
// §23 동시성: 두 관리자가 동시에 같은 단체를 반대로(또는 같은 방향으로)
// 전환 시도해도 안전하도록, 현재 상태를 where 조건에 포함한 조건부
// updateMany 하나로 원자적으로 처리한다 -- 불필요한 트랜잭션을 새로 만들지
// 않는다(§23의 명시적 요구).
export async function setOrganizationStatusForAdmin(
  admin: User,
  organizationId: number,
  nextStatus: "active" | "inactive",
): Promise<OrganizationMutationResult<{ id: number }>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const currentStatus = nextStatus === "active" ? PrismaOrganizationStatus.INACTIVE : PrismaOrganizationStatus.ACTIVE;

  const result = await prisma.organization.updateMany({
    where: { id: organizationId, status: currentStatus },
    data: { status: STATUS_TO_DB[nextStatus] },
  });
  if (result.count === 0) {
    const existing = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    return existing ? { kind: "invalid_state" } : { kind: "not_found" };
  }
  return { kind: "ok", data: { id: organizationId } };
}
