import { prisma } from "@/lib/db/prisma";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { NotificationType, Prisma, type User } from "@/generated/prisma/client";
import { MESSAGE_PAGE_SIZE } from "./schema";

// Same placeholder text as the legacy HIDDEN_MESSAGE_PLACEHOLDER --
// Message.hiddenAt/hiddenByUserId/hiddenReason exist in schema.prisma for
// the Report/ModerationAction "hide_message" action, which isn't
// implemented in this port (no Report/Moderation UI exists yet). Real
// content is never altered, only masked here for display, exactly as
// legacy does -- so if a future phase does implement moderation and sets
// hiddenAt directly, chat already honors it correctly.
const HIDDEN_MESSAGE_PLACEHOLDER = "[관리자에 의해 숨겨진 메시지입니다.]";

type PostRef = { id: number; userId: number; title: string };

type ChatRoomWithMatch = {
  id: number;
  matchId: number | null;
  createdAt: Date;
  match: {
    id: number;
    lostPost: PostRef;
    foundPost: PostRef;
  } | null;
};

export type ChatMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "match_not_found" }
  | { kind: "invalid_content" };

export type ChatRoomDetailDTO = {
  id: number;
  matchId: number;
  createdAt: Date;
  counterpart: { id: number; nickname: string | null };
  lostPost: { id: number; title: string };
  foundPost: { id: number; title: string };
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

async function findChatRoomWithMatch(chatRoomId: number): Promise<ChatRoomWithMatch | null> {
  return prisma.chatRoom.findUnique({
    where: { id: chatRoomId },
    select: {
      id: true,
      matchId: true,
      createdAt: true,
      match: {
        select: {
          id: true,
          lostPost: { select: POST_REF_SELECT },
          foundPost: { select: POST_REF_SELECT },
        },
      },
    },
  });
}

// Dispatches on room shape, same single funnel point every legacy
// permission check (_chat_room_participant_ids) goes through -- this
// phase only ever creates Match-based rooms (matchId set), but a room
// with no match relation (shouldn't exist yet) is treated as not_found
// rather than crashing.
function participantIdsOf(room: ChatRoomWithMatch): Set<number> | null {
  if (!room.match) return null;
  return new Set([room.match.lostPost.userId, room.match.foundPost.userId]);
}

async function resolveDetailDTO(
  room: ChatRoomWithMatch,
  requesterId: number,
): Promise<ChatRoomDetailDTO | null> {
  if (!room.match) return null;
  const counterpartUserId =
    room.match.lostPost.userId === requesterId ? room.match.foundPost.userId : room.match.lostPost.userId;
  const counterpart = await prisma.user.findUnique({
    where: { id: counterpartUserId },
    select: { id: true, nickname: true },
  });
  return {
    id: room.id,
    matchId: room.match.id,
    createdAt: room.createdAt,
    counterpart: counterpart ?? { id: counterpartUserId, nickname: null },
    lostPost: { id: room.match.lostPost.id, title: room.match.lostPost.title },
    foundPost: { id: room.match.foundPost.id, title: room.match.foundPost.title },
  };
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
    const room = await findChatRoomWithMatch(existing.id);
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

  const room = await findChatRoomWithMatch(createdId);
  const dto = room && (await resolveDetailDTO(room, requesterId));
  if (!dto) throw new Error(`Failed to load ChatRoom ${createdId} for Match ${matchId}`);
  return { kind: "ok", data: dto };
}

// Fetch a ChatRoom, but only for a requester who is actually a
// participant -- mirrors legacy get_chat_room(). Never trusts a
// client-supplied chatRoomId beyond using it to look the row up.
export async function getChatRoomForUser(
  chatRoomId: number,
  requesterId: number,
): Promise<ChatMutationResult<ChatRoomDetailDTO>> {
  const room = await findChatRoomWithMatch(chatRoomId);
  if (!room) return { kind: "not_found" };
  const participantIds = participantIdsOf(room);
  if (!participantIds) return { kind: "not_found" };
  if (!participantIds.has(requesterId)) return { kind: "forbidden" };

  const dto = await resolveDetailDTO(room, requesterId);
  if (!dto) return { kind: "not_found" };
  return { kind: "ok", data: dto };
}

// Every Match-based ChatRoom the user participates in (owner of the
// Match's LostPost and/or FoundPost side), most-recently-active first --
// mirrors the ordering intent of legacy list_chat_rooms_by_user() for the
// Match-room half of that function (this phase doesn't implement direct
// rooms, see schema.ts's scope note).
export async function listChatRoomsForUser(requesterId: number): Promise<ChatRoomListItemDTO[]> {
  const rooms = await prisma.chatRoom.findMany({
    where: { match: { OR: [{ lostPost: { userId: requesterId } }, { foundPost: { userId: requesterId } }] } },
    select: {
      id: true,
      matchId: true,
      createdAt: true,
      match: {
        select: {
          id: true,
          lostPost: { select: POST_REF_SELECT },
          foundPost: { select: POST_REF_SELECT },
        },
      },
      messages: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { content: true, createdAt: true, hiddenAt: true },
      },
    },
  });

  const items = await Promise.all(
    rooms.map(async (room) => {
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
  const room = await findChatRoomWithMatch(chatRoomId);
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
  const room = await findChatRoomWithMatch(chatRoomId);
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
  const room = await findChatRoomWithMatch(chatRoomId);
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
  const room = await findChatRoomWithMatch(chatRoomId);
  if (!room) return { kind: "not_found" };
  const participantIds = participantIdsOf(room);
  if (!participantIds || !room.match) return { kind: "not_found" };
  if (!participantIds.has(sender.id)) return { kind: "forbidden" };
  if (isCurrentlySuspended(sender)) return { kind: "forbidden" };

  const trimmed = content.trim();
  if (!trimmed) return { kind: "invalid_content" }; // defense-in-depth; the API's zod schema already rejects this

  const otherUserId =
    room.match.lostPost.userId === sender.id ? room.match.foundPost.userId : room.match.lostPost.userId;

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
