"use server";

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { hardDeleteUser } from "@/lib/account-delete";

// 본인 탈퇴 — 확인 문구 "탈퇴" 입력 필요.
export async function deleteMyAccount(_prev, formData) {
  const confirmText = (formData.get("confirm") || "").toString().trim();
  if (confirmText !== "탈퇴") {
    return { error: "확인란에 '탈퇴' 를 정확히 입력해 주세요." };
  }

  const session = await getSessionUser();
  if (!session) redirect("/login");

  try {
    await hardDeleteUser(session.user.id);
  } catch (e) {
    console.error("[deleteMyAccount]", e?.message);
    return {
      error:
        "탈퇴 처리에 실패했어요. 잠시 후 다시 시도하거나 고객센터로 문의해 주세요.",
    };
  }

  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    /* 이미 세션 무효 */
  }

  redirect("/login?bye=1");
}
