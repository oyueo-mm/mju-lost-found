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

// Phase 28-3: `content` alone used to always be required (min(1)); an
// image-only message has nothing to put there, so it's now optional at
// the schema level -- the "at least one of content/imagePath" rule is
// enforced by the .refine() below instead, and chat/service.ts::
// sendMessage() re-derives/re-validates imagePath server-side regardless
// (never trusts this shape alone -- same "the API schema is the first
// gate, the service function is the real one" convention every other
// mutation in this app follows).
export const sendMessageSchema = z
  .object({
    content: z.string().trim().max(MAX_MESSAGE_LENGTH, "메시지가 너무 깁니다.").optional(),
    imagePath: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.content) || Boolean(data.imagePath), {
    message: "메시지 또는 이미지를 입력해주세요.",
  });

// Cursor pagination (message id), not page/limit -- see
// idx_message_chat_room_created_id in schema.prisma, which this queries
// against directly. `before` is the smallest id already loaded; omitting
// it returns the most recent page.
export const listMessagesQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
});
