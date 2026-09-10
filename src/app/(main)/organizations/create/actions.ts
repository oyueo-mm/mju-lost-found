"use server";

import { revalidatePath } from "next/cache";

import { requireActiveUser } from "@/lib/auth/session";
import { cancelOrganizationCreationRequest, createOrganizationCreationRequest } from "@/lib/organization/service";
import { organizationCreationRequestSchema } from "@/lib/organization/schema";

export type CreateOrganizationRequestState = { error: string } | { ok: true };

// requireActiveUser() -- 로그인, 닉네임 설정, 정지되지 않음을 매 호출마다
// 세션에서 다시 확인한다(같은 gate every other user-facing Server Action in
// this app uses, see feedback/actions.ts::createFeedbackAction). 비로그인/
// 준비되지 않은/정지된 사용자는 이 함수 본문에 도달하기 전에 redirect된다.
export async function createOrganizationCreationRequestAction(input: {
  organizationName: string;
  organizationType: string;
  scope?: string;
  contactEmail: string;
  purpose: string;
}): Promise<CreateOrganizationRequestState> {
  const user = await requireActiveUser();

  const parsed = organizationCreationRequestSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요." };

  const result = await createOrganizationCreationRequest(user, parsed.data);
  if (result.kind === "duplicate_pending_request") {
    return { error: "이미 검토 대기 중인 단체 생성 신청이 있습니다. 처리 결과를 기다려주세요." };
  }
  if (result.kind !== "ok") return { error: "단체 생성 신청을 접수하지 못했습니다." };

  revalidatePath("/organizations/create");
  return { ok: true };
}

export type CancelOrganizationRequestState = { error: string } | { ok: true };

// 본인 신원은 항상 서버(requireActiveUser)가 결정한다 -- 클라이언트가 넘긴
// 값은 requestId(취소 대상) 하나뿐이며, 실제로 그 신청의 소유자인지는
// cancelOrganizationCreationRequest() 서비스 함수가 DB에서 다시 확인한다
// (organization/service.ts:: existing.requestedByUserId !== userId).
export async function cancelOrganizationCreationRequestAction(requestId: number): Promise<CancelOrganizationRequestState> {
  const user = await requireActiveUser();

  const result = await cancelOrganizationCreationRequest(user.id, requestId);
  if (result.kind === "not_found") return { error: "신청을 찾을 수 없습니다." };
  if (result.kind === "forbidden") return { error: "본인의 신청만 취소할 수 있습니다." };
  if (result.kind === "invalid_state") return { error: "이미 처리된 신청은 취소할 수 없습니다." };
  if (result.kind !== "ok") return { error: "신청을 취소하지 못했습니다." };

  revalidatePath("/organizations/create");
  return { ok: true };
}
