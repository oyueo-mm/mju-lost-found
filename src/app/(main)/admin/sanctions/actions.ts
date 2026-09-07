"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { markSuspensionAppealReviewed } from "@/lib/moderation/appeals";

export type ReviewAppealState = { error: string } | { ok: true };

// requireAdmin() re-verifies both "logged in" and "DB-flagged admin" from
// a fresh session read, same gate every other admin page/action in this
// app uses -- never trusts anything client-side about who's calling this.
export async function reviewAppealAction(appealId: number): Promise<ReviewAppealState> {
  const admin = await requireAdmin();
  const result = await markSuspensionAppealReviewed(admin, appealId);
  if (result.kind !== "ok") {
    return { error: "이의신청을 처리하지 못했습니다." };
  }
  revalidatePath("/admin/sanctions");
  return { ok: true };
}
