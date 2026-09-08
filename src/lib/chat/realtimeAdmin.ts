import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";

// Phase N: server -> client push for chat, via Supabase Realtime
// Broadcast -- deliberately NOT `postgres_changes` (raw table replication).
// This app has no Supabase Auth/RLS bridge (every DB access goes through
// Prisma with the pooled connection, authorized entirely in application
// code via NextAuth sessions -- see src/lib/auth/session.ts); Realtime
// Broadcast channels are open to any holder of the public anon key by
// default, exactly the same trust boundary the anon key already has
// everywhere else in this app (see supabase/browserClient.ts's own
// comment). Postgres Changes on "Message" would replicate full row
// content (sender, text, image URL) to anyone who subscribes with the
// right chat_room_id filter -- a small, guessable integer -- with no
// per-user authorization check possible without RLS. Broadcast has the
// same "anyone can subscribe" exposure, so the fix here is on the
// *payload* side: every event below carries only numeric ids, never
// message content, sender identity beyond what a chatRoomId already
// implies, or anything else meaningful to a non-participant. The
// participant-only *content* is always fetched back through the existing,
// fully-authorized GET /api/chat/[id]/messages endpoint -- this module
// only ever tells a subscribed client "something changed, go re-fetch"
// (or, for the read cursor, a bare id pair that's equally harmless to
// leak). Real access control for the actual data is exactly what it
// already was: participantIdsOf() in chat/service.ts, re-checked on every
// request.
export type ChatBroadcastEvent =
  | { event: "message"; payload: { messageId: number } }
  | { event: "reaction"; payload: { messageId: number } }
  | { event: "read"; payload: { userId: number; lastReadMessageId: number } };

function channelNameFor(chatRoomId: number): string {
  return `chat-room-${chatRoomId}`;
}

// Best-effort, matching every other "notify, but never let a failure here
// block the mutation that already succeeded" side effect in this app
// (embedPostBestEffort, deleteObjectSafely, ...). httpSend() -- not the
// implicit send()-without-subscribe fallback -- is used explicitly: this
// runs inside a Route Handler / Server Action, which never holds a live
// WebSocket connection, so REST delivery is the only mode that makes
// sense here; httpSend() is Supabase's own documented way to say that
// intent isn't a fallback.
export async function broadcastChatEvent(chatRoomId: number, event: ChatBroadcastEvent): Promise<void> {
  try {
    const channel = getSupabaseAdminClient().channel(channelNameFor(chatRoomId));
    await channel.httpSend(event.event, event.payload);
  } catch (error) {
    console.error(`Failed to broadcast chat realtime event "${event.event}" for room ${chatRoomId}:`, error);
  }
}
