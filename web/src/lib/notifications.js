import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// 다른 유저에게 알림 생성 (RLS 우회 필요 → admin 클라이언트).
export async function createNotification(userId, type, title, body = "", link = null) {
  try {
    const admin = createAdminClient();
    await admin
      .from("notifications")
      .insert({ user_id: userId, type, title, body, link });
  } catch (e) {
    console.error("[notification] 실패:", e?.message);
  }
}
