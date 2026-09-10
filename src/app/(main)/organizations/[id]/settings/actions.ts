"use server";

import { revalidatePath } from "next/cache";

import { requireActiveUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/moderation/service";
import {
  appointAdmin,
  approveJoinRequest,
  deactivateOrganization,
  rejectJoinRequest,
  removeAdmin,
  removeMember,
  transferLeadership,
  updateOrganizationProfile,
} from "@/lib/organization/service";
import { organizationProfileUpdateSchema, reviewOrganizationJoinRequestSchema } from "@/lib/organization/schema";

// Phase 12-4 §26: 이 파일의 모든 action은 requireActiveUser()로 신원만
// 확정하고, 실제 권한(LEADER/ADMIN 여부)은 각 서비스 함수가 authz.ts의
// canManageOrganization/canManageMembers/canAppointAdmin/canRemoveMember/
// canTransferLeadership/canDeactivateOrganization을 통해 매 호출마다 DB에서
// 다시 확인한다 -- 클라이언트가 넘긴 role은 어디에도 없다(애초에 받지도
// 않는다).

function revalidateOrganization(organizationId: number) {
  revalidatePath(`/organizations/${organizationId}`);
  revalidatePath(`/organizations/${organizationId}/settings`);
}

export type UpdateProfileState = { error: string } | { ok: true };

export async function updateOrganizationProfileAction(
  organizationId: number,
  input: { name: string; organizationType: string; description?: string; scope?: string; contactEmail?: string },
): Promise<UpdateProfileState> {
  const user = await requireActiveUser();

  const parsed = organizationProfileUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요." };

  const result = await updateOrganizationProfile(user.id, organizationId, parsed.data);
  if (result.kind === "forbidden") return { error: "단체 정보를 수정할 권한이 없습니다." };
  if (result.kind === "not_found") return { error: "단체를 찾을 수 없습니다." };
  if (result.kind !== "ok") return { error: "단체 정보를 수정하지 못했습니다." };

  revalidateOrganization(organizationId);
  return { ok: true };
}

export type MemberActionState = { error: string } | { ok: true };

export async function appointAdminAction(organizationId: number, targetUserId: number): Promise<MemberActionState> {
  const user = await requireActiveUser();

  const result = await appointAdmin(user.id, organizationId, targetUserId);
  if (result.kind === "forbidden") return { error: "ADMIN 임명 권한이 없습니다." };
  if (result.kind === "target_not_active_member") return { error: "대상이 이 단체의 구성원이 아닙니다." };
  if (result.kind === "invalid_state") return { error: "MEMBER만 ADMIN으로 임명할 수 있습니다." };
  if (result.kind !== "ok") return { error: "ADMIN 임명에 실패했습니다." };

  revalidateOrganization(organizationId);
  return { ok: true };
}

export async function removeAdminAction(organizationId: number, targetUserId: number): Promise<MemberActionState> {
  const user = await requireActiveUser();

  const result = await removeAdmin(user.id, organizationId, targetUserId);
  if (result.kind === "forbidden") return { error: "ADMIN 해임 권한이 없습니다." };
  if (result.kind === "target_not_active_member") return { error: "대상이 이 단체의 구성원이 아닙니다." };
  if (result.kind === "invalid_state") return { error: "ADMIN만 해임할 수 있습니다." };
  if (result.kind !== "ok") return { error: "ADMIN 해임에 실패했습니다." };

  revalidateOrganization(organizationId);
  return { ok: true };
}

export async function removeMemberAction(organizationId: number, targetUserId: number): Promise<MemberActionState> {
  const user = await requireActiveUser();

  const result = await removeMember(user.id, organizationId, targetUserId);
  if (result.kind === "forbidden") return { error: "이 구성원을 제거할 권한이 없습니다." };
  if (result.kind === "not_found") return { error: "대상이 이 단체의 구성원이 아닙니다." };
  if (result.kind !== "ok") return { error: "구성원 제거에 실패했습니다." };

  revalidateOrganization(organizationId);
  return { ok: true };
}

export type TransferLeadershipState = { error: string } | { ok: true };

// canTransferLeadership은 "현재 LEADER 본인"만 통과하므로 targetUserId만
// 클라이언트에서 받고, 실제로 호출자가 LEADER인지는 transferLeadership()
// 내부(current.role !== LEADER -> forbidden)가 다시 확인한다.
export async function transferLeadershipAction(
  organizationId: number,
  targetUserId: number,
): Promise<TransferLeadershipState> {
  const user = await requireActiveUser();

  const result = await transferLeadership(organizationId, user.id, targetUserId);
  if (result.kind === "forbidden") return { error: "대표 관리자만 권한을 위임할 수 있습니다." };
  if (result.kind === "target_not_active_member") return { error: "대상이 이 단체의 구성원이 아닙니다." };
  if (result.kind === "invalid_state") return { error: "본인에게 위임할 수 없습니다." };
  if (result.kind !== "ok") return { error: "대표 관리자 권한 위임에 실패했습니다." };

  revalidateOrganization(organizationId);
  return { ok: true };
}

export type JoinRequestReviewState = { error: string } | { ok: true };

export async function approveOrganizationJoinRequestAction(
  organizationId: number,
  requestId: number,
): Promise<JoinRequestReviewState> {
  const user = await requireActiveUser();

  const result = await approveJoinRequest(user.id, requestId);
  if (result.kind === "not_found") return { error: "신청을 찾을 수 없습니다." };
  if (result.kind === "forbidden") return { error: "가입 신청을 승인할 권한이 없습니다." };
  if (result.kind === "invalid_state") return { error: "이미 처리된 신청입니다." };
  if (result.kind !== "ok") return { error: "가입 신청을 승인하지 못했습니다." };

  revalidateOrganization(organizationId);
  return { ok: true };
}

export async function rejectOrganizationJoinRequestAction(
  organizationId: number,
  requestId: number,
  input: { rejectionReason?: string },
): Promise<JoinRequestReviewState> {
  const user = await requireActiveUser();

  const parsed = reviewOrganizationJoinRequestSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요." };

  const result = await rejectJoinRequest(user.id, requestId, parsed.data);
  if (result.kind === "not_found") return { error: "신청을 찾을 수 없습니다." };
  if (result.kind === "forbidden") return { error: "가입 신청을 거절할 권한이 없습니다." };
  if (result.kind === "invalid_state") return { error: "이미 처리된 신청입니다." };
  if (result.kind !== "ok") return { error: "가입 신청을 거절하지 못했습니다." };

  revalidateOrganization(organizationId);
  return { ok: true };
}

export type DeactivateOrganizationState = { error: string } | { ok: true };

// §22: LEADER 또는 Platform Admin. requireActiveUser() 이후 세션에서 다시
// 확인한 user.isAdmin을 canDeactivateOrganization의 override 파라미터로
// 넘긴다 -- 클라이언트가 "나는 admin이다"라고 주장할 방법이 없다.
export async function deactivateOrganizationAction(organizationId: number): Promise<DeactivateOrganizationState> {
  const user = await requireActiveUser();

  const result = await deactivateOrganization(user.id, organizationId, isAdmin(user));
  if (result.kind === "forbidden") return { error: "단체를 비활성화할 권한이 없습니다." };
  if (result.kind === "not_found") return { error: "단체를 찾을 수 없습니다." };
  if (result.kind === "invalid_state") return { error: "이미 비활성화된 단체입니다." };
  if (result.kind !== "ok") return { error: "단체를 비활성화하지 못했습니다." };

  revalidateOrganization(organizationId);
  revalidatePath("/organizations");
  return { ok: true };
}
