"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { setOrganizationStatusForAdmin } from "@/lib/organization/service";

// Phase 12-6 §10/§21: requireAdmin()이 세션의 로그인/닉네임/정지 여부와
// User.isAdmin(DB)을 이미 다시 확인하므로, 비관리자는 이 함수 본문에
// 도달하기 전에 redirect된다. setOrganizationStatusForAdmin() 자신도
// isAdmin(admin)을 다시 확인한다(§10: "service 계층에서도 실제 DB의
// user.isAdmin을 다시 확인한다") -- 이중 방어, 클라이언트가 "나는
// admin이다"를 주장할 방법이 어디에도 없다.
export type SetOrganizationStatusState = { error: string } | { ok: true };

export async function setOrganizationStatusAction(
  organizationId: number,
  nextStatus: "active" | "inactive",
): Promise<SetOrganizationStatusState> {
  const admin = await requireAdmin();

  const result = await setOrganizationStatusForAdmin(admin, organizationId, nextStatus);
  if (result.kind === "forbidden") return { error: "권한이 없습니다." };
  if (result.kind === "not_found") return { error: "단체를 찾을 수 없습니다." };
  if (result.kind === "invalid_state") return { error: "현재 단체 상태에서는 해당 작업을 수행할 수 없습니다." };
  if (result.kind !== "ok") return { error: "단체 상태를 변경하지 못했습니다." };

  revalidatePath("/admin/organizations");
  revalidatePath(`/admin/organizations/${organizationId}`);
  // Phase 12-6 §27: 사용자용 프로필 페이지도 같은 status를 보여주므로 함께
  // revalidate -- 관리자 페이지 전용 캐시를 새로 만들지 않는다.
  revalidatePath(`/organizations/${organizationId}`);
  return { ok: true };
}
