"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { reviewNoteSchema, reviewRejoinRequest } from "@/lib/auth/rejoin";

export type RejoinReviewActionState = { error: string } | { ok: true };

// Same gate as every other admin Server Action: requireAdmin() re-reads the
// session and the DB isAdmin flag on each call, and the service re-checks.
export async function reviewRejoinRequestAction(
  requestId: number,
  decision: "approve" | "reject",
  note: string,
): Promise<RejoinReviewActionState> {
  const admin = await requireAdmin();
  if (decision !== "approve" && decision !== "reject") return { error: "잘못된 요청입니다." };
  const parsedNote = reviewNoteSchema.safeParse(note ?? "");
  if (!parsedNote.success) return { error: parsedNote.error.issues[0]?.message ?? "메모를 확인해주세요." };

  const result = await reviewRejoinRequest(admin, requestId, decision, parsedNote.data);
  if (result.kind === "already_reviewed") return { error: "이미 처리된 요청입니다." };
  if (result.kind !== "ok") return { error: "처리하지 못했습니다." };
  revalidatePath("/admin/rejoin-requests");
  return { ok: true };
}
