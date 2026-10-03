"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { createExternalAccessSchema, updateExternalAccessSchema } from "@/lib/externalAccess/schema";
import {
  createExternalAccessGrant,
  reactivateExternalAccessGrant,
  revokeExternalAccessGrant,
  updateExternalAccessGrant,
} from "@/lib/externalAccess/service";

export type ExternalAccessActionState = { error: string } | { ok: true };

// Same gate as every other admin Server Action: requireAdmin() re-reads
// the session and the DB isAdmin flag on each call (a non-admin is
// redirected before any input is parsed), and the service functions
// re-check isAdmin themselves.

export async function createExternalAccessAction(input: {
  email: string;
  name: string;
  affiliation: string;
  campus: string;
}): Promise<ExternalAccessActionState> {
  const admin = await requireAdmin();
  const parsed = createExternalAccessSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요." };

  const result = await createExternalAccessGrant(admin, parsed.data);
  if (result.kind === "duplicate") return { error: "이미 등록된 이메일입니다. 목록에서 상태를 확인해주세요." };
  if (result.kind !== "ok") return { error: "등록하지 못했습니다." };
  revalidatePath("/admin/external-access");
  return { ok: true };
}

export async function updateExternalAccessAction(
  id: number,
  input: { name: string; affiliation: string; campus: string },
): Promise<ExternalAccessActionState> {
  const admin = await requireAdmin();
  const parsed = updateExternalAccessSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요." };

  const result = await updateExternalAccessGrant(admin, id, parsed.data);
  if (result.kind !== "ok") return { error: "수정하지 못했습니다." };
  revalidatePath("/admin/external-access");
  return { ok: true };
}

export async function revokeExternalAccessAction(id: number): Promise<ExternalAccessActionState> {
  const admin = await requireAdmin();
  const result = await revokeExternalAccessGrant(admin, id);
  if (result.kind !== "ok") return { error: "승인을 취소하지 못했습니다." };
  revalidatePath("/admin/external-access");
  return { ok: true };
}

export async function reactivateExternalAccessAction(id: number): Promise<ExternalAccessActionState> {
  const admin = await requireAdmin();
  const result = await reactivateExternalAccessGrant(admin, id);
  if (result.kind !== "ok") return { error: "다시 승인하지 못했습니다." };
  revalidatePath("/admin/external-access");
  return { ok: true };
}
