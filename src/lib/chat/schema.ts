import { z } from "zod";

import { postTypeSchema } from "@/lib/posts/schema";

// Matches the legacy MESSAGE_PAGE_SIZE constant exactly.
export const MESSAGE_PAGE_SIZE = 50;

// The legacy app has no content length cap at all (Message.content is
// unbounded TEXT, and its Streamlit st.chat_input() passes no max_chars).
// This is a new, API-layer-only bound -- same reasoning as the post
// field caps in posts/schema.ts: a public write endpoint needs its own
// sane upper limit regardless of what the column allows.
export const MAX_MESSAGE_LENGTH = 2000;

// POST /api/chat accepts either shape: a Match-based room (mirrors legacy
// get_or_create_chat_room) or a Phase 10 "direct" room -- a viewer
// messaging a post's author straight from the board, no Match required
// (mirrors legacy get_or_create_direct_chat_room). postType/postId reuse
// posts/schema.ts's own postTypeSchema rather than redeclaring "lost"/
// "found" here.
export const createMatchChatRoomSchema = z.object({
  matchId: z.coerce.number().int().positive("matchId가 올바르지 않습니다."),
});

export const createDirectChatRoomSchema = z.object({
  postType: postTypeSchema,
  postId: z.coerce.number().int().positive("postId가 올바르지 않습니다."),
});

export const createChatRoomSchema = z.union([createMatchChatRoomSchema, createDirectChatRoomSchema]);

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
