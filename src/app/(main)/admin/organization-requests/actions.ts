"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { approveOrganizationCreationRequest, rejectOrganizationCreationRequest } from "@/lib/organization/service";
import { approveOrganizationCreationRequestSchema, rejectOrganizationCreationRequestSchema } from "@/lib/organization/schema";

export type ApproveOrganizationRequestState = { error: string } | { ok: true; organizationId: number };

// requireAdmin() re-verifies both "logged in" and "DB-flagged admin" from a
// fresh session read, same gate every other admin Server Action in this
// app uses (see admin/announcements/actions.ts's own comment). Both
// approveOrganizationCreationRequest()/rejectOrganizationCreationRequest()
// re-check isAdmin() themselves regardless -- never trusts this gate
// alone.
export async function approveOrganizationCreationRequestAction(
  requestId: number,
  input?: { adminNote?: string },
): Promise<ApproveOrganizationRequestState> {
  const admin = await requireAdmin();

  const parsed = approveOrganizationCreationRequestSchema.safeParse(input ?? {});
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요." };

  const result = await approveOrganizationCreationRequest(admin, requestId, parsed.data);
  if (result.kind === "not_found") return { error: "신청을 찾을 수 없습니다." };
  if (result.kind === "invalid_state") return { error: "이미 처리된 신청입니다." };
  if (result.kind !== "ok") return { error: "신청을 승인하지 못했습니다." };

  revalidatePath("/admin/organization-requests");
  revalidatePath(`/admin/organization-requests/${requestId}`);
  return { ok: true, organizationId: result.data.organizationId };
}

export type RejectOrganizationRequestState = { error: string } | { ok: true };

export async function rejectOrganizationCreationRequestAction(
  requestId: number,
  input: { rejectionReason: string; adminNote?: string },
): Promise<RejectOrganizationRequestState> {
  const admin = await requireAdmin();

  const parsed = rejectOrganizationCreationRequestSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "거절 사유를 입력해주세요." };

  const result = await rejectOrganizationCreationRequest(admin, requestId, parsed.data);
  if (result.kind === "not_found") return { error: "신청을 찾을 수 없습니다." };
  if (result.kind === "invalid_state") return { error: "이미 처리된 신청입니다." };
  if (result.kind !== "ok") return { error: "신청을 거절하지 못했습니다." };

  revalidatePath("/admin/organization-requests");
  revalidatePath(`/admin/organization-requests/${requestId}`);
  return { ok: true };
}
