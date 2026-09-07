import { prisma } from "@/lib/db/prisma";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { NotificationType, Prisma, type User } from "@/generated/prisma/client";
import type { PostType } from "@/lib/posts/schema";
import { parseChatImagePathname } from "@/lib/images/pathname";
import { publicUrlFor } from "@/lib/images/supabaseAdmin";
import { MESSAGE_PAGE_SIZE } from "./schema";

// Same placeholder text as the legacy HIDDEN_MESSAGE_PLACEHOLDER --
// Message.hiddenAt/hiddenByUserId/hiddenReason exist in schema.prisma for
// the Report/ModerationAction "hide_message" action. Real content is
// never altered, only masked here for display, exactly as legacy does.
const HIDDEN_MESSAGE_PLACEHOLDER = "[관리자에 의해 숨겨진 메시지입니다.]";

// Phase H-6: imageUrl added so a chat room header can show the related
// post's thumbnail -- an already-existing LostPost/FoundPost column, not a
// schema change; every consumer of PostRef already tolerates new fields
// (none of them spread/destructure it exhaustively), so this is additive.
type PostRef = { id: number; userId: number; title: string; imageUrl: string | null };

// A ChatRoom row is exactly one of two shapes (see schema.prisma's own
// comment on the model): Match-based (match set, direct* all null) or
// direct (match null, exactly one of directLostPost/directFoundPost set
// plus initiatorUserId) -- never both, never neither, for any row this
// app itself creates. Both shapes are fetched by the same query so every
// permission/read function below can dispatch through one place
// (participantIdsOf/toDetailDTO), mirroring legacy's single
// _chat_room_participant_ids() funnel for both room kinds.
type ChatRoomRow = {
  id: number;
  matchId: number | null;
  initiatorUserId: number | null;
  createdAt: Date;
  match: { id: number; lostPost: PostRef; foundPost: PostRef } | null;
  directLostPost: PostRef | null;
  directFoundPost: PostRef | null;
};

export type ChatMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "forbidden"; reason?: "suspended" | "self" }
  | { kind: "match_not_found" }
  | { kind: "invalid_content" }
  // Phase 28-3: imagePath was given but doesn't parse as a real chat
  // image pathname, or names a different chat room than the one the
  // message is being sent to -- see sendMessage()'s own comment.
  | { kind: "invalid_image" }
  // Phase D-3: replyToMessageId was given but doesn't name a real message
  // in *this* chat room -- see sendMessage()'s own comment. No depth
  // restriction (unlike Comment.parentId): replying to a reply is normal
  // chat UX, so this is only ever "wrong room or doesn't exist", never
  // "already a reply".
  | { kind: "invalid_reply" }
  // Phase D-4: messageId was given but doesn't name a real message in
  // *this* chat room -- see toggleMessageReaction()'s own comment. Same
  // shape as invalid_reply for the same reason (never trust a client-
  // supplied messageId/chatRoomId pairing).
  | { kind: "invalid_reaction" };

// Discriminated on roomType so a caller (UI included) can never confuse
// the two shapes -- e.g. a "match" room always has both lostPost and
// foundPost, a "direct" room always has exactly one `post` (plus which
// board it's on). Mirrors legacy list_chat_rooms_by_user()'s own
// room_type field/branch.
export type ChatRoomDetailDTO =
  | {
      roomType: "match";
      id: number;
      matchId: number;
      createdAt: Date;
      counterpart: { id: number; nickname: string | null };
      lostPost: { id: number; title: string; imageUrl: string | null };
      foundPost: { id: number; title: string; imageUrl: string | null };
    }
  | {
      roomType: "direct";
      id: number;
      createdAt: Date;
      counterpart: { id: number; nickname: string | null };
      post: { id: number; title: string; type: PostType; imageUrl: string | null };
    };

export type ChatRoomListItemDTO = ChatRoomDetailDTO & {
  lastMessage: { content: string; createdAt: Date } | null;
};

// Phase D-3: the replied-to message's own preview travels with every
// reply (not just its id) so the client can render it inline with zero
// extra round-trips -- same masking rule as the reply itself: a hidden
// original shows the placeholder, never its real content. null means
// either this message isn't a reply, or (onDelete: SetNull) the
// original's own replyToMessageId link was cleared.
export type MessageReplyPreview = {
  id: number;
  senderNickname: string | null;
  content: string;
  hasImage: boolean;
};

// Phase D-4: one entry per distinct emoji actually used on this message
// (never one row per reaction) -- reactedByMe lets the client highlight
// which of these badges the current user themselves picked, without it
// having to cross-reference anything else.
export type ReactionSummary = { emoji: string; count: number; reactedByMe: boolean };

export type MessageDTO = {
  id: number;
  senderUserId: number;
  senderNickname: string | null;
  content: string;
  imageUrl: string | null;
  createdAt: Date;
  readAt: Date | null;
  isMine: boolean;
  replyTo: MessageReplyPreview | null;
  reactions: ReactionSummary[];
};

const POST_REF_SELECT = { id: true, userId: true, title: true, imageUrl: true } as const;

// Phase D-3: shared by listMessages/sendMessage so both build the exact
// same reply-preview shape from the exact same raw shape (whatever a
// `replyToMessage: { select: MESSAGE_REPLY_SELECT }` include returns).
const MESSAGE_REPLY_SELECT = {
  id: true,
  content: true,
  imageUrl: true,
  hiddenAt: true,
  sender: { select: { nickname: true } },
} as const;

type RawReplyTarget = {
  id: number;
  content: string;
  imageUrl: string | null;
  hiddenAt: Date | null;
  sender: { nickname: string | null };
};

function toReplyPreview(raw: RawReplyTarget | null): MessageReplyPreview | null {
  if (!raw) return null;
  return {
    id: raw.id,
    senderNickname: raw.sender.nickname,
    content: raw.hiddenAt ? HIDDEN_MESSAGE_PLACEHOLDER : raw.content,
    hasImage: raw.hiddenAt ? false : Boolean(raw.imageUrl),
  };
}

// Phase D-4: shared by listMessages (grouping many messages' worth of
// raw rows at once) and toggleMessageReaction (a single message) -- both
// fold flat {emoji, userId} rows into one summary per distinct emoji.
// Order is insertion order (first time each emoji is seen), which is
// stable enough for a handful of fixed emoji and needs no separate sort.
function summarizeReactions(rows: { emoji: string; userId: number }[], requesterId: number): ReactionSummary[] {
  const byEmoji = new Map<string, ReactionSummary>();
  for (const row of rows) {
    const entry = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, reactedByMe: false };
    entry.count += 1;
    if (row.userId === requesterId) entry.reactedByMe = true;
    byEmoji.set(row.emoji, entry);
  }
  return [...byEmoji.values()];
}

async function findChatRoomRow(chatRoomId: number): Promise<ChatRoomRow | null> {
  return prisma.chatRoom.findUnique({
    where: { id: chatRoomId },
    select: {
      id: true,
      matchId: true,
      initiatorUserId: true,
      createdAt: true,
      match: {
        select: {
          id: true,
          lostPost: { select: POST_REF_SELECT },
          foundPost: { select: POST_REF_SELECT },
        },
      },
      directLostPost: { select: POST_REF_SELECT },
      directFoundPost: { select: POST_REF_SELECT },
    },
  });
}

// Dispatches on room shape, same single funnel point every legacy
// permission check (_chat_room_participant_ids) goes through, for both
// room kinds. A row with neither match nor a direct post set (shouldn't
// exist -- every row this app creates is one or the other) is treated as
// not_found rather than crashing.
function participantIdsOf(room: ChatRoomRow): Set<number> | null {
  if (room.match) return new Set([room.match.lostPost.userId, room.match.foundPost.userId]);
  const directPost = room.directLostPost ?? room.directFoundPost;
  if (directPost && room.initiatorUserId !== null) {
    return new Set([directPost.userId, room.initiatorUserId]);
  }
  return null;
}

// Phase D-2: shared by report/service.ts's message-report membership
// check -- reuses this exact single-funnel participant derivation (both
// room shapes) instead of re-deriving it in the report domain. Takes a
// chatRoomId, not a client-supplied one -- the caller is expected to
// pass the *message's own* chatRoomId (read fresh from the DB, see
// resolveMessageTarget), never anything the client claims, so a report
// request can't assert membership in a room it doesn't actually belong
// to.
export async function getChatRoomParticipantIds(chatRoomId: number): Promise<Set<number> | null> {
  const room = await findChatRoomRow(chatRoomId);
  if (!room) return null;
  return participantIdsOf(room);
}

async function resolveDetailDTO(
  room: ChatRoomRow,
  requesterId: number,
): Promise<ChatRoomDetailDTO | null> {
  if (room.match) {
    const counterpartUserId =
      room.match.lostPost.userId === requesterId ? room.match.foundPost.userId : room.match.lostPost.userId;
    const counterpart = await resolveCounterpart(counterpartUserId);
    return {
      roomType: "match",
      id: room.id,
      matchId: room.match.id,
      createdAt: room.createdAt,
      counterpart,
      lostPost: { id: room.match.lostPost.id, title: room.match.lostPost.title, imageUrl: room.match.lostPost.imageUrl },
      foundPost: {
        id: room.match.foundPost.id,
        title: room.match.foundPost.title,
        imageUrl: room.match.foundPost.imageUrl,
      },
    };
  }

  const directPost = room.directLostPost ?? room.directFoundPost;
  if (!directPost || room.initiatorUserId === null) return null;
  const counterpartUserId = directPost.userId === requesterId ? room.initiatorUserId : directPost.userId;
  const counterpart = await resolveCounterpart(counterpartUserId);
  return {
    roomType: "direct",
    id: room.id,
    createdAt: room.createdAt,
    counterpart,
    post: {
      id: directPost.id,
      title: directPost.title,
      type: room.directLostPost ? "lost" : "found",
      imageUrl: directPost.imageUrl,
    },
  };
}

async function resolveCounterpart(userId: number): Promise<{ id: number; nickname: string | null }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true } });
  return user ?? { id: userId, nickname: null };
}

// Get-or-create the single ChatRoom for a Match -- mirrors legacy
// get_or_create_chat_room(): requester must own the Match's LostPost or
// FoundPost side, idempotent (backed by ChatRoom.matchId's UNIQUE
// constraint), and a concurrent creation race is resolved by re-fetching
// the winner rather than erroring, same P2002-recovery shape
// createMatch() already uses.
export async function getOrCreateChatRoomForMatch(
  matchId: number,
  requesterId: number,
): Promise<ChatMutationResult<ChatRoomDetailDTO>> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { id: true, lostPost: { select: POST_REF_SELECT }, foundPost: { select: POST_REF_SELECT } },
  });
  if (!match) return { kind: "match_not_found" };
  if (requesterId !== match.lostPost.userId && requesterId !== match.foundPost.userId) {
    return { kind: "forbidden" };
  }

  const existing = await prisma.chatRoom.findUnique({ where: { matchId } });
  if (existing) {
    const room = await findChatRoomRow(existing.id);
    const dto = room && (await resolveDetailDTO(room, requesterId));
    if (dto) return { kind: "ok", data: dto };
  }

  let createdId: number;
  try {
    const created = await prisma.chatRoom.create({ data: { matchId }, select: { id: true } });
    createdId = created.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.chatRoom.findUnique({ where: { matchId } });
      if (!winner) throw error;
      createdId = winner.id;
    } else {
      throw error;
    }
  }

  const room = await findChatRoomRow(createdId);
  const dto = room && (await resolveDetailDTO(room, requesterId));
  if (!dto) throw new Error(`Failed to load ChatRoom ${createdId} for Match ${matchId}`);
  return { kind: "ok", data: dto };
}

// Phase 10: get-or-create a *direct* ChatRoom between requester (the
// initiator/viewer) and a LostPost's or FoundPost's current author -- NOT
// mediated by a Match, unlike getOrCreateChatRoomForMatch() above. Lets a
// board viewer message a post's author straight away. Mirrors legacy
// get_or_create_direct_chat_room() exactly, including validation order:
// 1) requester not suspended, 2) post exists, 3) requester isn't the
// post's own author (no self-chat). Idempotent via the DB's own
// idx_chatroom_direct_{lost,found}_unique constraint (already present in
// schema.prisma/the applied migration -- see the Phase 10 report; no
// schema change needed for this): a second call for the same (post,
// initiator) pair returns the existing room, and a concurrent create race
// is resolved by re-fetching the winner, the same P2002-recovery shape
// getOrCreateChatRoomForMatch() uses.
export async function getOrCreateDirectChatRoom(
  postType: PostType,
  postId: number,
  requester: User,
): Promise<ChatMutationResult<ChatRoomDetailDTO>> {
  if (isCurrentlySuspended(requester)) {
    return { kind: "forbidden", reason: "suspended" };
  }

  const post =
    postType === "lost"
      ? await prisma.lostPost.findUnique({ where: { id: postId }, select: { id: true, userId: true } })
      : await prisma.foundPost.findUnique({ where: { id: postId }, select: { id: true, userId: true } });
  // A missing post covers both "never existed" and "deleted" -- the row
  // simply isn't found either way, no separate check needed.
  if (!post) return { kind: "not_found" };
  if (post.userId === requester.id) return { kind: "forbidden", reason: "self" };

  // The compound-unique field name Prisma generates is derived from the
  // column list itself (directLostPostId_initiatorUserId), NOT from the
  // @@unique's `map` name in schema.prisma (that only names the actual
  // SQL index/constraint) -- verified against the generated client types.
  const directColumn = postType === "lost" ? ({ directLostPostId: postId } as const) : ({ directFoundPostId: postId } as const);
  const uniqueWhere =
    postType === "lost"
      ? { directLostPostId_initiatorUserId: { directLostPostId: postId, initiatorUserId: requester.id } }
      : { directFoundPostId_initiatorUserId: { directFoundPostId: postId, initiatorUserId: requester.id } };

  const existing = await prisma.chatRoom.findUnique({ where: uniqueWhere });
  if (existing) {
    const room = await findChatRoomRow(existing.id);
    const dto = room && (await resolveDetailDTO(room, requester.id));
    if (dto) return { kind: "ok", data: dto };
  }

  let createdId: number;
  try {
    const created = await prisma.chatRoom.create({
      data: { ...directColumn, initiatorUserId: requester.id },
      select: { id: true },
    });
    createdId = created.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.chatRoom.findUnique({ where: uniqueWhere });
      if (!winner) throw error;
      createdId = winner.id;
    } else {
      throw error;
    }
  }

  const room = await findChatRoomRow(createdId);
  const dto = room && (await resolveDetailDTO(room, requester.id));
  if (!dto) throw new Error(`Failed to load direct ChatRoom ${createdId} for ${postType} post ${postId}`);
  return { kind: "ok", data: dto };
}

// Fetch a ChatRoom, but only for a requester who is actually a
// participant -- mirrors legacy get_chat_room(), for either room shape.
// Never trusts a client-supplied chatRoomId beyond using it to look the
// row up.
export async function getChatRoomForUser(
  chatRoomId: number,
  requesterId: number,
): Promise<ChatMutationResult<ChatRoomDetailDTO>> {
  const room = await findChatRoomRow(chatRoomId);
  if (!room) return { kind: "not_found" };
  const participantIds = participantIdsOf(room);
  if (!participantIds) return { kind: "not_found" };
  if (!participantIds.has(requesterId)) return { kind: "forbidden" };

  const dto = await resolveDetailDTO(room, requesterId);
  if (!dto) return { kind: "not_found" };
  return { kind: "ok", data: dto };
}

// Every ChatRoom (Match-based or direct) the user participates in, most-
// recently-active first -- mirrors legacy list_chat_rooms_by_user(), now
// covering both room kinds it does (Phase 10). Match rooms: owner of
// either post side. Direct rooms: the initiator, or the post's current
// author.
export async function listChatRoomsForUser(requesterId: number): Promise<ChatRoomListItemDTO[]> {
  const CHAT_ROOM_SELECT = {
    id: true,
    matchId: true,
    initiatorUserId: true,
    createdAt: true,
    match: {
      select: {
        id: true,
        lostPost: { select: POST_REF_SELECT },
        foundPost: { select: POST_REF_SELECT },
      },
    },
    directLostPost: { select: POST_REF_SELECT },
    directFoundPost: { select: POST_REF_SELECT },
    messages: {
      orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
      take: 1,
      select: { content: true, createdAt: true, hiddenAt: true },
    },
  };

  const [matchRooms, directRooms] = await Promise.all([
    prisma.chatRoom.findMany({
      where: { match: { OR: [{ lostPost: { userId: requesterId } }, { foundPost: { userId: requesterId } }] } },
      select: CHAT_ROOM_SELECT,
    }),
    prisma.chatRoom.findMany({
      where: {
        matchId: null,
        OR: [
          { initiatorUserId: requesterId },
          { directLostPost: { userId: requesterId } },
          { directFoundPost: { userId: requesterId } },
        ],
      },
      select: CHAT_ROOM_SELECT,
    }),
  ]);

  const items = await Promise.all(
    [...matchRooms, ...directRooms].map(async (room) => {
      const dto = await resolveDetailDTO(room, requesterId);
      if (!dto) return null;
      const last = room.messages[0];
      const lastMessage = last
        ? { content: last.hiddenAt ? HIDDEN_MESSAGE_PLACEHOLDER : last.content, createdAt: last.createdAt }
        : null;
      return { ...dto, lastMessage };
    }),
  );

  const results = items.filter((item): item is ChatRoomListItemDTO => item !== null);
  // Rooms with a message sort by that message's time desc; roomless chats
  // sort after all of those, newest room first -- matches legacy's stated
  // ordering intent.
  results.sort((a, b) => {
    const aTime = a.lastMessage?.createdAt.getTime() ?? -Infinity;
    const bTime = b.lastMessage?.createdAt.getTime() ?? -Infinity;
    if (aTime !== bTime) return bTime - aTime;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return results;
}

// Up to MESSAGE_PAGE_SIZE messages, oldest-first in the returned array
// (mirrors legacy list_messages()). Cursor-based: omitting `before`
// returns the most recent page; passing the smallest id already loaded
// pages further back. hasMore is determined via the same limit+1
// lookahead legacy's caller uses, avoiding a separate COUNT query.
export async function listMessages(
  chatRoomId: number,
  requesterId: number,
  before?: number,
): Promise<ChatMutationResult<{ items: MessageDTO[]; hasMore: boolean }>> {
  const room = await findChatRoomRow(chatRoomId);
  if (!room) return { kind: "not_found" };
  const participantIds = participantIdsOf(room);
  if (!participantIds) return { kind: "not_found" };
  if (!participantIds.has(requesterId)) return { kind: "forbidden" };

  const rows = await prisma.message.findMany({
    where: { chatRoomId, ...(before !== undefined && { id: { lt: before } }) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MESSAGE_PAGE_SIZE + 1,
    include: {
      sender: { select: { nickname: true } },
      replyToMessage: { select: MESSAGE_REPLY_SELECT },
    },
  });

  const hasMore = rows.length > MESSAGE_PAGE_SIZE;
  const page = rows.slice(0, MESSAGE_PAGE_SIZE).reverse(); // oldest-first for display

  // Phase D-4: one batched query for every message on this page (never
  // one query per message) -- grouped in memory afterward, same "avoid
  // N+1" reasoning as everywhere else in this app that resolves a
  // to-many relation for a list.
  const reactionRows =
    page.length > 0
      ? await prisma.messageReaction.findMany({
          where: { messageId: { in: page.map((m) => m.id) } },
          select: { messageId: true, emoji: true, userId: true },
        })
      : [];
  const reactionsByMessageId = new Map<number, { emoji: string; userId: number }[]>();
  for (const r of reactionRows) {
    const list = reactionsByMessageId.get(r.messageId);
    if (list) list.push(r);
    else reactionsByMessageId.set(r.messageId, [r]);
  }

  const items: MessageDTO[] = page.map((m) => ({
    id: m.id,
    senderUserId: m.senderUserId,
    senderNickname: m.sender.nickname,
    content: m.hiddenAt ? HIDDEN_MESSAGE_PLACEHOLDER : m.content,
    // A hidden message's image is masked too -- same "real content never
    // altered, only masked for display" rule as `content` above (an admin
    // hiding a message shouldn't leave its photo visible while its text
    // is replaced).
    imageUrl: m.hiddenAt ? null : m.imageUrl,
    createdAt: m.createdAt,
    readAt: m.readAt,
    isMine: m.senderUserId === requesterId,
    replyTo: toReplyPreview(m.replyToMessage),
    // Reactions are metadata about the message, not its content -- shown
    // the same whether or not the message itself is hidden (same "hidden
    // masks content/image, never blocks an action" policy replies and
    // reports already follow).
    reactions: summarizeReactions(reactionsByMessageId.get(m.id) ?? [], requesterId),
  }));

  return { kind: "ok", data: { items, hasMore } };
}

// Marks the *other* participant's unread messages as read by requesterId
// -- never the requester's own messages. Mirrors legacy
// mark_messages_as_read(); DB-level bulk update, not a fetch-then-loop.
export async function markMessagesAsRead(
  chatRoomId: number,
  requesterId: number,
): Promise<ChatMutationResult<{ count: number }>> {
  const room = await findChatRoomRow(chatRoomId);
  if (!room) return { kind: "not_found" };
  const participantIds = participantIdsOf(room);
  if (!participantIds) return { kind: "not_found" };
  if (!participantIds.has(requesterId)) return { kind: "forbidden" };

  const { count } = await prisma.message.updateMany({
    where: { chatRoomId, senderUserId: { not: requesterId }, readAt: null },
    data: { readAt: new Date() },
  });
  return { kind: "ok", data: { count } };
}

// Marks requesterId's own "message"-type Notifications tied to this room
// as read -- mirrors legacy mark_message_notifications_as_read_for_chat_room().
// Kept as its own function (not folded into markMessagesAsRead), same
// separation legacy uses, since Notification.isRead and Message.readAt
// are two distinct concepts only synced at this one call site.
export async function markMessageNotificationsReadForChatRoom(
  chatRoomId: number,
  requesterId: number,
): Promise<ChatMutationResult<{ count: number }>> {
  const room = await findChatRoomRow(chatRoomId);
  if (!room) return { kind: "not_found" };
  const participantIds = participantIdsOf(room);
  if (!participantIds) return { kind: "not_found" };
  if (!participantIds.has(requesterId)) return { kind: "forbidden" };

  const messageIds = await prisma.message.findMany({
    where: { chatRoomId },
    select: { id: true },
  });
  if (messageIds.length === 0) return { kind: "ok", data: { count: 0 } };

  const { count } = await prisma.notification.updateMany({
    where: {
      userId: requesterId,
      type: NotificationType.MESSAGE,
      relatedType: "message",
      relatedId: { in: messageIds.map((m) => m.id) },
      isRead: false,
    },
    data: { isRead: true },
  });
  return { kind: "ok", data: { count } };
}

// Sends a message as `sender` -- the sender is always the verified
// current user, never a caller-supplied id (see the route handler: the
// request body only ever carries `content`). On success, the *other*
// participant (never the sender) gets a "message" Notification in the
// same transaction as the INSERT, matching legacy send_message() exactly
// -- relatedType/relatedId point at the new message's own id (not the
// chat room's), so distinct messages each get their own notification
// instead of colliding on Notification's
// UNIQUE(userId, type, relatedType, relatedId).
// Phase 28-3: imagePath is the Storage *path* the client already uploaded
// to via POST /api/chat/[id]/upload (which itself gated the upload on
// chat-room membership) -- never a client-supplied URL, same "the server
// derives the URL itself from a re-validated path" rule
// posts/images/service.ts::setPostImage already established. Re-parsing
// it here and requiring it to name exactly this chatRoomId is what closes
// the gap a trusted-URL design would leave open (a participant of room A
// reporting room B's path/URL as their own).
export async function sendMessage(
  chatRoomId: number,
  sender: User,
  content: string,
  imagePath?: string,
  replyToMessageId?: number,
): Promise<ChatMutationResult<MessageDTO>> {
  const room = await findChatRoomRow(chatRoomId);
  if (!room) return { kind: "not_found" };
  const participantIds = participantIdsOf(room);
  if (!participantIds) return { kind: "not_found" };
  if (!participantIds.has(sender.id)) return { kind: "forbidden" };
  if (isCurrentlySuspended(sender)) return { kind: "forbidden" };

  const trimmed = content.trim();

  let imageUrl: string | null = null;
  if (imagePath) {
    const parsed = parseChatImagePathname(imagePath);
    if (!parsed || parsed.chatRoomId !== chatRoomId) return { kind: "invalid_image" };
    imageUrl = publicUrlFor(imagePath);
  }

  // An image-only message stores "" for content (the column stays
  // required/NOT NULL -- see schema.prisma's own comment on this) --
  // "nothing at all" is only rejected when there's no image either,
  // matching the API schema's own .refine() (defense-in-depth; that
  // schema already rejects this shape before it reaches here).
  if (!trimmed && !imageUrl) return { kind: "invalid_content" };

  // Phase D-3: resolved once, up front (same pattern as
  // comment/service.ts's own parent-comment check) -- re-checked against
  // *this* chatRoomId, never trusting that a client-supplied
  // replyToMessageId actually belongs here. Hidden or not doesn't matter:
  // replying to an already-hidden message is allowed (its own preview is
  // masked the same way listMessages() masks it for display), same as
  // this app never blocking a *report* on an already-hidden message
  // either.
  let replyTarget: RawReplyTarget | null = null;
  if (replyToMessageId !== undefined) {
    const target = await prisma.message.findUnique({
      where: { id: replyToMessageId },
      select: { chatRoomId: true, ...MESSAGE_REPLY_SELECT },
    });
    if (!target || target.chatRoomId !== chatRoomId) return { kind: "invalid_reply" };
    replyTarget = target;
  }

  // Works for either room shape: participantIds is always exactly the
  // sender + the one other participant (a direct room's initiator/post-
  // author pair are guaranteed distinct at creation time -- see
  // getOrCreateDirectChatRoom()'s self-chat check -- so this only ever
  // falls back to sender.id itself for a Match room's self-match case).
  const otherUserId = [...participantIds].find((id) => id !== sender.id) ?? sender.id;

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        chatRoomId,
        senderUserId: sender.id,
        content: trimmed,
        imageUrl,
        replyToMessageId: replyTarget?.id ?? null,
      },
      include: { sender: { select: { nickname: true } } },
    });

    // Self-match (the same user owns both the LostPost and FoundPost
    // side): there is no "other participant" to notify, same as legacy's
    // next(iter(ids - {sender}), None) -> None -> no notification.
    if (otherUserId !== sender.id) {
      await tx.notification.create({
        data: {
          userId: otherUserId,
          type: NotificationType.MESSAGE,
          title: "새 메시지가 도착했습니다",
          content: `${sender.nickname ?? "상대방"}님이 메시지를 보냈습니다.`,
          relatedType: "message",
          relatedId: created.id,
        },
      });
    }

    return created;
  });

  return {
    kind: "ok",
    data: {
      id: message.id,
      senderUserId: message.senderUserId,
      senderNickname: message.sender.nickname,
      content: message.content,
      imageUrl: message.imageUrl,
      createdAt: message.createdAt,
      readAt: message.readAt,
      isMine: true,
      replyTo: toReplyPreview(replyTarget),
      reactions: [], // a message can't already have reactions the moment it's created
    },
  };
}

// Phase D-4: toggles requester's own (messageId, emoji) reaction --
// second click on the same emoji removes it, matching every other emoji-
// reaction UI (Slack/KakaoTalk/Instagram). Re-validates room membership
// the same way sendMessage/listMessages do (never trusts anything about
// the message beyond its id), then re-validates that messageId actually
// belongs to *this* chatRoomId -- same "never trust a client-supplied
// id pairing" rule as sendMessage's own replyToMessageId check. Hidden
// messages are never special-cased here: reactions are metadata about
// the message, not its (masked) content, so this follows the same
// "hidden doesn't block an action" policy report/reply already use.
export async function toggleMessageReaction(
  chatRoomId: number,
  messageId: number,
  emoji: string,
  requester: User,
): Promise<ChatMutationResult<{ messageId: number; reactions: ReactionSummary[] }>> {
  const room = await findChatRoomRow(chatRoomId);
  if (!room) return { kind: "not_found" };
  const participantIds = participantIdsOf(room);
  if (!participantIds) return { kind: "not_found" };
  if (!participantIds.has(requester.id)) return { kind: "forbidden" };

  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { chatRoomId: true } });
  if (!message || message.chatRoomId !== chatRoomId) return { kind: "invalid_reaction" };

  // Toggle: a delete that actually removed a row means "was on, now off".
  // Finding nothing to delete means "was off" -- create it. The @@unique
  // constraint (not this deleteMany/create sequence) is what actually
  // prevents a genuine duplicate under a concurrent double-click; the
  // P2002 catch below just converts that race into the same successful
  // "on" result the winner of the race already gets, same
  // recovery-not-precheck pattern createComment/createReport use for
  // their own unique constraints.
  const removed = await prisma.messageReaction.deleteMany({
    where: { messageId, userId: requester.id, emoji },
  });

  if (removed.count === 0) {
    try {
      await prisma.messageReaction.create({ data: { messageId, userId: requester.id, emoji } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
        throw error;
      }
    }
  }

  const rows = await prisma.messageReaction.findMany({
    where: { messageId },
    select: { emoji: true, userId: true },
  });
  return { kind: "ok", data: { messageId, reactions: summarizeReactions(rows, requester.id) } };
}

// Phase 11: resolves a "message"-type Notification's relatedId (a Message
// id -- see sendMessage()'s `relatedId: created.id` above, never a
// ChatRoom id) to the room it belongs to. Mirrors legacy get_message(),
// used the same way there (pages/8_알림.py's _handle_confirm reads the
// message to find its chat_room_id, then re-verifies room access the
// normal way). Deliberately returns only chatRoomId, not the message
// content/sender -- callers here only ever need it to build a link, and
// re-derive real access via getChatRoomForUser() themselves; this
// function performs no authorization of its own.
export async function getMessage(messageId: number): Promise<{ id: number; chatRoomId: number } | null> {
  return prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, chatRoomId: true },
  });
}

// Phase 17: chat tab's unread badge (Navigation). Reuses exactly the same
// two-query room-scoping WHERE clauses listChatRoomsForUser() uses (only
// `select: { id: true }` instead of the full detail shape) to find every
// room this user participates in, then counts messages in those rooms
// that are someone else's (senderUserId != requesterId, otherwise your
// own sent messages would count as "unread") and not yet read
// (readAt: null). A hidden message (Report/ModerationAction) is still
// counted -- the notification badge signals "something happened here",
// not "there's readable new content"; opening the room is what actually
// clears it via markMessagesAsRead().
export async function countUnreadMessagesForUser(requesterId: number): Promise<number> {
  const [matchRooms, directRooms] = await Promise.all([
    prisma.chatRoom.findMany({
      where: { match: { OR: [{ lostPost: { userId: requesterId } }, { foundPost: { userId: requesterId } }] } },
      select: { id: true },
    }),
    prisma.chatRoom.findMany({
      where: {
        matchId: null,
        OR: [
          { initiatorUserId: requesterId },
          { directLostPost: { userId: requesterId } },
          { directFoundPost: { userId: requesterId } },
        ],
      },
      select: { id: true },
    }),
  ]);
  const roomIds = [...matchRooms, ...directRooms].map((r) => r.id);
  if (roomIds.length === 0) return 0;

  return prisma.message.count({
    where: {
      chatRoomId: { in: roomIds },
      senderUserId: { not: requesterId },
      readAt: null,
    },
  });
}
