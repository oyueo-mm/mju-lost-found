export async function listRooms(supabase, userId) {
  const { data } = await supabase
    .from("chat_rooms")
    .select(
      `id, context_title, last_message_at, user_a, user_b,
       a:profiles!chat_rooms_user_a_fkey(id, nickname),
       b:profiles!chat_rooms_user_b_fkey(id, nickname)`,
    )
    .order("last_message_at", { ascending: false });

  const rooms = data || [];

  // 각 방의 안 읽은 메시지 수
  const withMeta = await Promise.all(
    rooms.map(async (r) => {
      const other = r.user_a === userId ? r.b : r.a;
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("room_id", r.id)
        .neq("sender_id", userId)
        .is("read_at", null);
      const { data: last } = await supabase
        .from("messages")
        .select("content, image_url, created_at")
        .eq("room_id", r.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return { ...r, other, unread: count || 0, lastMessage: last };
    }),
  );
  return withMeta;
}

const ROOM_SELECT_FULL = `id, context_title, user_a, user_b, lost_post_id, found_post_id,
   deal_confirmed_a, deal_confirmed_b, deal_completed_at,
   a:profiles!chat_rooms_user_a_fkey(id, nickname, trust_score),
   b:profiles!chat_rooms_user_b_fkey(id, nickname, trust_score)`;
const ROOM_SELECT_BASE = `id, context_title, user_a, user_b, lost_post_id, found_post_id,
   a:profiles!chat_rooms_user_a_fkey(id, nickname),
   b:profiles!chat_rooms_user_b_fkey(id, nickname)`;

export async function getRoom(supabase, roomId, userId) {
  // phase-17(명지도) 미적용 DB 에서도 동작하도록 폴백
  let { data: room } = await supabase
    .from("chat_rooms")
    .select(ROOM_SELECT_FULL)
    .eq("id", roomId)
    .maybeSingle();
  if (!room) {
    ({ data: room } = await supabase
      .from("chat_rooms")
      .select(ROOM_SELECT_BASE)
      .eq("id", roomId)
      .maybeSingle());
  }
  if (!room) return null;
  if (room.user_a !== userId && room.user_b !== userId) return null;

  const iAmA = room.user_a === userId;
  room.other = iAmA ? room.b : room.a;
  room.deal = {
    completed: !!room.deal_completed_at,
    mine: iAmA ? !!room.deal_confirmed_a : !!room.deal_confirmed_b,
    other: iAmA ? !!room.deal_confirmed_b : !!room.deal_confirmed_a,
    available: "deal_completed_at" in room,
  };

  // 이 대화가 걸린 게시물 (채팅방 상단에 표시)
  room.contextPost = null;
  const targets = [
    room.found_post_id && ["found_posts", "found", room.found_post_id],
    room.lost_post_id && ["lost_posts", "lost", room.lost_post_id],
  ].filter(Boolean);
  for (const [table, kind, postId] of targets) {
    const { data } = await supabase
      .from(table)
      .select("id, title, status, category, image_url, image_urls")
      .eq("id", postId)
      .maybeSingle();
    if (data) {
      room.contextPost = { ...data, kind };
      break;
    }
  }
  return room;
}

export async function listMessages(supabase, roomId) {
  const { data } = await supabase
    .from("messages")
    .select("id, sender_id, content, image_url, created_at, read_at, hidden_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .limit(500);
  const messages = (data || []).map((m) =>
    m.hidden_at
      ? { ...m, content: "[관리자가 가린 메시지입니다.]", image_url: null }
      : m,
  );
  if (messages.length === 0) return messages;

  const { data: reactions } = await supabase
    .from("message_reactions")
    .select("message_id, user_id, emoji")
    .in(
      "message_id",
      messages.map((m) => m.id),
    );

  const byMsg = new Map();
  for (const r of reactions || []) {
    if (!byMsg.has(r.message_id)) byMsg.set(r.message_id, []);
    byMsg.get(r.message_id).push(r);
  }
  for (const m of messages) m.reactions = byMsg.get(m.id) || [];
  return messages;
}
