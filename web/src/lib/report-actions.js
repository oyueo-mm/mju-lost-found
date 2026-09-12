"use server";

import { requireUser, isSuspended, SUSPENDED_MSG } from "@/lib/auth";
import { REPORT_REASONS } from "@/lib/constants";
import { rateLimited } from "@/lib/ratelimit";

export async function submitReport(targetType, targetId, _prev, formData) {
  const reason = (formData.get("reason") || "").toString();
  const detail = (formData.get("detail") || "").toString().trim();

  if (!REPORT_REASONS.includes(reason))
    return { error: "신고 사유를 선택해 주세요." };

  const { user, profile, supabase } = await requireUser();
  if (isSuspended(profile)) return { error: SUSPENDED_MSG };
  const limited = await rateLimited(user.id, "report");
  if (limited) return { error: limited };
  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    target_type: targetType,
    target_id: String(targetId),
    reason,
    detail: detail || null,
  });

  if (error) {
    if (error.code === "23505") return { error: "이미 신고한 대상이에요." };
    return { error: "신고 접수에 실패했어요." };
  }
  return { ok: true };
}
