"use server";

import { requireAdmin } from "@/lib/auth/session";
import { viewIdentityForPurpose } from "@/lib/identity/service";
import type { IdentityViewState } from "@/app/(main)/admin/reports/[id]/identityActions";

// 운영 목적 이름·소속 열람 (분실물 인계 문의, 소유권 분쟁, 사칭 의심). A
// server action is reachable by anyone who can post to it, so the admin
// check runs here (requireAdmin) and again in viewIdentityForPurpose, which
// also checks the purpose, the reason and the member's consent, and logs
// the view. Report views keep their own action (reports/[id]/identityActions).
export async function viewMemberIdentityForPurposeAction(
  _prev: IdentityViewState,
  formData: FormData,
): Promise<IdentityViewState> {
  const admin = await requireAdmin();
  const targetUserId = Number(formData.get("targetUserId"));
  if (!Number.isInteger(targetUserId)) return { ok: false, error: "잘못된 요청입니다." };

  const result = await viewIdentityForPurpose(admin, {
    targetUserId,
    purpose: formData.get("purpose"),
    reason: formData.get("reason"),
  });
  switch (result.kind) {
    case "ok":
      return {
        ok: true,
        targetUserId,
        nickname: result.data.nickname,
        realName: result.data.realName,
        department: result.data.department,
        realNameSource: result.data.realNameSource,
        departmentSource: result.data.departmentSource,
        updatedAt: result.data.updatedAt?.toISOString() ?? null,
      };
    case "invalid_purpose":
      return { ok: false, error: "열람 목적을 선택해주세요." };
    case "invalid_reason":
      return { ok: false, error: "열람 사유를 5자 이상 500자 이하로 입력해주세요." };
    case "not_consented":
      return {
        ok: false,
        error: "이 이용자는 개정된 이름·소속 동의를 아직 하지 않아 운영 목적으로는 열람할 수 없습니다. 관련 신고가 있으면 신고 처리 목적으로 열람할 수 있습니다.",
      };
    case "not_found":
      return { ok: false, error: "대상 이용자를 찾을 수 없습니다." };
    case "forbidden":
      return { ok: false, error: "관리자만 열람할 수 있습니다." };
  }
}
