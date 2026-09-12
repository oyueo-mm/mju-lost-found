"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, isSuspended, isEmailPermitted } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications";
import { rateLimited } from "@/lib/ratelimit";

// 정지된 계정도 호출할 수 있는 유일한 쓰기 액션. isSuspended 가드를 두지 않는다.
export async function submitAppeal(_prev, formData) {
  const text = (formData.get("text") || "").toString().trim();
  if (text.length < 10) {
    return { error: "상황을 조금 더 자세히 적어주세요. (10자 이상)" };
  }
  if (text.length > 1000) return { error: "1000자 이내로 적어주세요." };

  const session = await getSessionUser();
  if (!session) return { error: "로그인이 필요해요." };
  if (!(await isEmailPermitted(session.user.email))) {
    return { error: "이용할 수 없는 계정이에요." };
  }
  if (!isSuspended(session.profile)) {
    return { error: "정지 상태가 아니에요." };
  }
  const limited = await rateLimited(session.user.id, "appeal");
  if (limited) return { error: limited };

  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({ appeal_text: text, appeal_at: new Date().toISOString() })
    .eq("id", session.user.id);

  const { data: admins } = await admin
    .from("profiles")
    .select("id")
    .or("role.eq.admin,is_admin.eq.true");
  const who = session.profile?.nickname || session.user.email;
  for (const a of admins || []) {
    if (a.id === session.user.id) continue;
    await createNotification(
      a.id,
      "appeal",
      `이의 제기 · ${who}`,
      text.slice(0, 140),
      "/admin/users",
    );
  }

  revalidatePath("/suspended");
  return { ok: true };
}
