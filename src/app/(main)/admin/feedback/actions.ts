"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { updateFeedbackStatus } from "@/lib/feedback/service";
import { updateFeedbackStatusSchema } from "@/lib/feedback/schema";

export type UpdateFeedbackStatusState = { error: string } | { ok: true };

// requireAdmin() re-verifies both "logged in" and "DB-flagged admin" from a
// fresh session read, same gate every other admin Server Action in this
// app uses (see admin/announcements/actions.ts's own comment) -- never
// trusts anything client-side about who's calling this. updateFeedbackStatus()
// itself re-checks isAdmin() again regardless (belt-and-suspenders, same
// as every other admin service function in this app).
export async function updateFeedbackStatusAction(
  id: number,
  input: { status: string; adminNote?: string },
): Promise<UpdateFeedbackStatusState> {
  const admin = await requireAdmin();

  const parsed = updateFeedbackStatusSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요." };

  const result = await updateFeedbackStatus(admin, id, parsed.data);
  if (result.kind === "not_found") return { error: "의견을 찾을 수 없습니다." };
  if (result.kind !== "ok") return { error: "상태를 변경하지 못했습니다." };

  revalidatePath("/admin/feedback");
  revalidatePath(`/admin/feedback/${id}`);
  return { ok: true };
}
