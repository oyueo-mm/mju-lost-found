"use server";

import { requireAdmin } from "@/lib/auth/session";
import { viewIdentityForReport } from "@/lib/identity/service";

export type IdentityViewState =
  | { ok: true; targetUserId: number; nickname: string | null; realName: string | null; department: string | null; updatedAt: string | null }
  | { ok: false; error: string }
  | null;

// 신고 당사자 실명·학과 열람. A server action is reachable by anyone who can
// post to it, so the admin check runs here (requireAdmin) and again in
// viewIdentityForReport, which also limits the target to this report's
// reporter or reported member, requires the reason, and logs the view.
export async function viewReportPartyIdentityAction(_prev: IdentityViewState, formData: FormData): Promise<IdentityViewState> {
  const admin = await requireAdmin();
  const reportId = Number(formData.get("reportId"));
  const targetUserId = Number(formData.get("targetUserId"));
  if (!Number.isInteger(reportId) || !Number.isInteger(targetUserId)) return { ok: false, error: "잘못된 요청입니다." };

  const result = await viewIdentityForReport(admin, { reportId, targetUserId, reason: formData.get("reason") });
  switch (result.kind) {
    case "ok":
      return {
        ok: true,
        targetUserId,
        nickname: result.data.nickname,
        realName: result.data.realName,
        department: result.data.department,
        updatedAt: result.data.updatedAt?.toISOString() ?? null,
      };
    case "invalid_reason":
      return { ok: false, error: "열람 사유를 5자 이상 500자 이하로 입력해주세요." };
    case "not_found":
      return { ok: false, error: "신고 또는 대상 이용자를 찾을 수 없습니다." };
    case "forbidden":
      return { ok: false, error: "이 신고의 신고자나 피신고자만 열람할 수 있습니다." };
  }
}
