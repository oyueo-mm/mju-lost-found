import { z } from "zod";

// Matches the legacy MESSAGE_PAGE_SIZE constant exactly.
export const MESSAGE_PAGE_SIZE = 50;

// The legacy app has no content length cap at all (Message.content is
// unbounded TEXT, and its Streamlit st.chat_input() passes no max_chars).
// This is a new, API-layer-only bound -- same reasoning as the post
// field caps in posts/schema.ts: a public write endpoint needs its own
// sane upper limit regardless of what the column allows.
export const MAX_MESSAGE_LENGTH = 2000;

// Scope note: this phase only implements Match-based chat rooms (see the
// Phase 10 report) -- the legacy app's "direct" (non-Match, DM-a-post-
// author) ChatRoom shape that schema.prisma also supports is not wired up
// to any UI this phase, so there's no create-schema for it here.
export const createChatRoomSchema = z.object({
  matchId: z.coerce.number().int().positive("matchId가 올바르지 않습니다."),
});

export const sendMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "메시지를 입력해주세요.")
    .max(MAX_MESSAGE_LENGTH, "메시지가 너무 깁니다."),
});

// Cursor pagination (message id), not page/limit -- see
// idx_message_chat_room_created_id in schema.prisma, which this queries
// against directly. `before` is the smallest id already loaded; omitting
// it returns the most recent page.
export const listMessagesQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
});
