// 처리 전까지 계속 떠 있어야 하는 알림 카운트 (읽음 상태가 아니라 실제 상태 기준)

export async function unreadMessageCount(supabase, userId) {
  const { data: rooms } = await supabase
    .from("chat_rooms")
    .select("id")
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);
  const ids = (rooms || []).map((r) => r.id);
  if (ids.length === 0) return 0;

  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .in("room_id", ids)
    .neq("sender_id", userId)
    .is("read_at", null);
  return count || 0;
}

export async function pendingReportCount(adminClient) {
  const { count } = await adminClient
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count || 0;
}
