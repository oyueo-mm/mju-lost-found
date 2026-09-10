"use server";

import { revalidatePath } from "next/cache";

import { requireActiveUser } from "@/lib/auth/session";
import { cancelJoinRequest, createJoinRequest, leaveOrganization } from "@/lib/organization/service";
import { organizationJoinRequestSchema } from "@/lib/organization/schema";

// Phase 12-4 §6/§26: requireActiveUser()가 매 호출마다 세션에서 신원을 다시
// 확인하므로, 클라이언트가 넘긴 organizationId만 신뢰하고 나머지(누가
// 신청하는가)는 항상 서버가 결정한다. 실제 가입 가능 여부(활성 단체인지,
// 이미 멤버인지, 중복 PENDING인지)는 createJoinRequest 서비스 함수가 재검증.
export type JoinOrganizationState = { error: string } | { ok: true };

export async function createOrganizationJoinRequestAction(
  organizationId: number,
  input: { message?: string },
): Promise<JoinOrganizationState> {
  const user = await requireActiveUser();

  const parsed = organizationJoinRequestSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요." };

  const result = await createJoinRequest(user.id, organizationId, parsed.data);
  if (result.kind === "not_found") return { error: "단체를 찾을 수 없습니다." };
  if (result.kind === "inactive_organization") return { error: "비활성화된 단체에는 가입 신청할 수 없습니다." };
  if (result.kind === "already_member") return { error: "이미 가입된 단체입니다." };
  if (result.kind === "duplicate_pending_request") return { error: "이미 처리 대기 중인 가입 신청이 있습니다." };
  if (result.kind !== "ok") return { error: "가입 신청을 접수하지 못했습니다." };

  revalidatePath(`/organizations/${organizationId}`);
  return { ok: true };
}

export type CancelJoinRequestState = { error: string } | { ok: true };

export async function cancelOrganizationJoinRequestAction(
  organizationId: number,
  requestId: number,
): Promise<CancelJoinRequestState> {
  const user = await requireActiveUser();

  const result = await cancelJoinRequest(user.id, requestId);
  if (result.kind === "not_found") return { error: "신청을 찾을 수 없습니다." };
  if (result.kind === "forbidden") return { error: "본인의 신청만 취소할 수 있습니다." };
  if (result.kind === "invalid_state") return { error: "이미 처리된 신청은 취소할 수 없습니다." };
  if (result.kind !== "ok") return { error: "신청을 취소하지 못했습니다." };

  revalidatePath(`/organizations/${organizationId}`);
  return { ok: true };
}

export type LeaveOrganizationState = { error: string } | { ok: true };

// §21: 본인 탈퇴만 -- leaveOrganization() 자체가 호출자 본인의 멤버십만
// 삭제하도록 userId를 항상 세션에서 가져온다(targetUserId를 받지 않음).
export async function leaveOrganizationAction(organizationId: number): Promise<LeaveOrganizationState> {
  const user = await requireActiveUser();

  const result = await leaveOrganization(user.id, organizationId);
  if (result.kind === "not_a_member") return { error: "이 단체의 구성원이 아닙니다." };
  if (result.kind === "last_leader_cannot_leave") {
    return { error: "마지막 대표 관리자는 탈퇴할 수 없습니다. 먼저 다른 구성원에게 대표 관리자 권한을 위임해주세요." };
  }
  if (result.kind !== "ok") return { error: "탈퇴하지 못했습니다." };

  revalidatePath(`/organizations/${organizationId}`);
  revalidatePath("/me");
  return { ok: true };
}
