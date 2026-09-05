import { prisma } from "@/lib/db/prisma";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { NotificationType, Prisma, type User } from "@/generated/prisma/client";
import type { PostType } from "@/lib/posts/schema";
import { MESSAGE_PAGE_SIZE } from "./schema";

// Same placeholder text as the legacy HIDDEN_MESSAGE_PLACEHOLDER --
// Message.hiddenAt/hiddenByUserId/hiddenReason exist in schema.prisma for
// the Report/ModerationAction "hide_message" action. Real content is
// never altered, only masked here for display, exactly as legacy does.
const HIDDEN_MESSAGE_PLACEHOLDER = "[관리자에 의해 숨겨진 메시지입니다.]";

type PostRef = { id: number; userId: number; title: string };

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
  | { kind: "invalid_content" };

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
      lostPost: { id: number; title: string };
      foundPost: { id: number; title: string };
    }
  | {
      roomType: "direct";
      id: number;
      createdAt: Date;
      counterpart: { id: number; nickname: string | null };
      post: { id: number; title: string; type: PostType };
    };

export type ChatRoomListItemDTO = ChatRoomDetailDTO & {
  lastMessage: { content: string; createdAt: Date } | null;
};

export type MessageDTO = {
  id: number;
  senderUserId: number;
  senderNickname: string | null;
  content: string;
  createdAt: Date;
  readAt: Date | null;
  isMine: boolean;
};

const POST_REF_SELECT = { id: true, userId: true, title: true } as const;

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
      lostPost: { id: room.match.lostPost.id, title: room.match.lostPost.title },
      foundPost: { id: room.match.foundPost.id, title: room.match.foundPost.title },
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
    post: { id: directPost.id, title: directPost.title, type: room.directLostPost ? "lost" : "found" },
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
    include: { sender: { select: { nickname: true } } },
  });

  const hasMore = rows.length > MESSAGE_PAGE_SIZE;
  const page = rows.slice(0, MESSAGE_PAGE_SIZE).reverse(); // oldest-first for display

  const items: MessageDTO[] = page.map((m) => ({
    id: m.id,
    senderUserId: m.senderUserId,
    senderNickname: m.sender.nickname,
    content: m.hiddenAt ? HIDDEN_MESSAGE_PLACEHOLDER : m.content,
    createdAt: m.createdAt,
    readAt: m.readAt,
    isMine: m.senderUserId === requesterId,
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
export async function sendMessage(
  chatRoomId: number,
  sender: User,
  content: string,
): Promise<ChatMutationResult<MessageDTO>> {
  const room = await findChatRoomRow(chatRoomId);
  if (!room) return { kind: "not_found" };
  const participantIds = participantIdsOf(room);
  if (!participantIds) return { kind: "not_found" };
  if (!participantIds.has(sender.id)) return { kind: "forbidden" };
  if (isCurrentlySuspended(sender)) return { kind: "forbidden" };

  const trimmed = content.trim();
  if (!trimmed) return { kind: "invalid_content" }; // defense-in-depth; the API's zod schema already rejects this

  // Works for either room shape: participantIds is always exactly the
  // sender + the one other participant (a direct room's initiator/post-
  // author pair are guaranteed distinct at creation time -- see
  // getOrCreateDirectChatRoom()'s self-chat check -- so this only ever
  // falls back to sender.id itself for a Match room's self-match case).
  const otherUserId = [...participantIds].find((id) => id !== sender.id) ?? sender.id;

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: { chatRoomId, senderUserId: sender.id, content: trimmed },
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
      createdAt: message.createdAt,
      readAt: message.readAt,
      isMine: true,
    },
  };
}
