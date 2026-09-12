"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function markAllNotificationsRead() {
  const { user, supabase } = await requireUser();
  await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", user.id)
    .eq("is_read", false);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function markNotificationsRead(ids) {
  const { user, supabase } = await requireUser();
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (list.length === 0) return;
  await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", user.id)
    .in("id", list)
    .eq("is_read", false);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function deleteNotifications(ids) {
  const { user } = await requireUser();
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (list.length === 0) return;
  // notifications 테이블에 DELETE RLS 정책이 없어서 유저 클라이언트로는 안 지워짐
  // → admin 클라이언트 + user_id 필터로 본인 것만 삭제.
  const admin = createAdminClient();
  await admin
    .from("notifications")
    .delete()
    .eq("user_id", user.id)
    .in("id", list);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}
