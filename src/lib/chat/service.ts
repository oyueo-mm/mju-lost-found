import { prisma } from "@/lib/db/prisma";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { NotificationType, OrganizationRole, OrganizationStatus, Prisma, type User } from "@/generated/prisma/client";
import type { PostType } from "@/lib/posts/schema";
import { parseChatImagePathname } from "@/lib/images/pathname";
import { deleteObjectSafely, publicUrlFor } from "@/lib/images/supabaseAdmin";
import { getMembership } from "@/lib/organization/authz";
import { fanOutToOrganizationManagers } from "@/lib/notification/adminFanout";
import { broadcastChatEvent } from "./realtimeAdmin";
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

// Phase J-2: a ChatRoom row used to be one of two shapes (Match-based or
// direct). The Match domain is gone, so every row is now direct: exactly
// one of directLostPost/directFoundPost set, plus initiatorUserId. All
// permission/read functions below still dispatch through one place
// (participantIdsOf/resolveDetailDTO), mirroring legacy's single
// _chat_room_participant_ids() funnel.
//
// Phase 12-11 §4/§20: counterpartUserId/organizationId are now each
// independently nullable -- exactly one is ever set on a real row (see
// ChatRoom's own schema.prisma comment for the full invariant and its DB-
// level CHECK constraint backstop). null/null or both-set never occurs in
// practice; every function below still treats "neither branch applies" as
// not_found rather than assuming one shape.
type ChatRoomRow = {
  id: number;
  initiatorUserId: number | null;
  counterpartUserId: number | null;
  organizationId: number | null;
  createdAt: Date;
  directLostPost: PostRef | null;
  directFoundPost: PostRef | null;
};

export type ChatMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  // Phase 12-11 §19: "organization_manager" -- the requester is already a
  // LEADER/ADMIN of the very organization they're trying to open a new
  // inquiry with (self-inquiry to one's own org makes no sense: see
  // getOrCreateOrganizationChatRoom's own comment). Distinct from "self"
  // (personal chat's own self-chat guard) since the two guards check
  // completely different things.
  | { kind: "forbidden"; reason?: "suspended" | "self" | "organization_manager" }
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
  | { kind: "invalid_reaction" }
  // Phase P-6: same "wrong room or doesn't exist" shape as invalid_reply/
  // invalid_reaction, for editMessage/deleteMessage's own messageId.
  | { kind: "invalid_message" }
  // Phase 12-11 §17: the post's organization is INACTIVE ("폐쇄") -- a new
  // inquiry can't be opened, mirroring validateOrganizationPosting's own
  // "inactive_organization" kind in organization/service.ts. Existing
  // inquiry rooms into a since-closed organization are completely
  // unaffected (getChatRoomForUser/listMessages/sendMessage never check
  // organization status -- only room creation does).
  | { kind: "inactive_organization" };

// Phase 12-11 §13: a room's "other side" is either a real person (personal
// chat) or the organization itself (inquiry chat) -- never conflated, and
// never a User row standing in for an organization or vice versa (this
// phase's own explicit warning against treating the two as the same
// thing).
export type ChatCounterpart =
  | { kind: "user"; id: number; nickname: string | null; publicId: string | null }
  | { kind: "organization"; id: number; name: string };

// Phase J-2: `roomType` is kept on the DTO so every existing consumer
// (chat list/detail UI, tests) keeps reading the same field it already
// did. Phase 12-11: a second value, "organization", was added -- never
// replacing "direct".
export type ChatRoomDetailDTO = {
  roomType: "direct" | "organization";
  id: number;
  createdAt: Date;
  counterpart: ChatCounterpart;
  // Phase 12-11 §13/§14: populated only for an organization room -- the
  // actual person who opened the inquiry (the room's own initiatorUserId).
  // Lets the UI be context-aware without a second query: the inquirer's
  // own client only needs `counterpart` (the organization); an org
  // admin's client, viewing someone else's inquiry, additionally shows
  // this to render "홍길동 → 총학생회 문의" instead of just "총학생회". Always
  // null for a personal room.
  inquirer: { id: number; nickname: string | null; publicId: string | null } | null;
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
  // Phase P-6: null means never edited -- see schema.prisma's own comment
  // on Message.editedAt. Never set on a hidden/deleted message's masked
  // display (there's nothing meaningful to call "edited" once its real
  // content is hidden).
  editedAt: Date | null;
  // Phase P-6: true once hiddenAt is set (self-delete or admin hide) --
  // exposed as a plain boolean (never hiddenAt/hiddenByUserId themselves)
  // so the client can gate 수정/삭제/복사 without needing to know *who*
  // hid it or reconstruct that from the masked content string.
  isDeleted: boolean;
  // Phase N: replaces the old per-message `readAt: Date | null` -- whether
  // the *other* participant has read this message, derived from their own
  // ChatRead cursor (message.id <= their lastReadMessageId), not a
  // per-message timestamp anymore. Only meaningful (and only ever
  // rendered) for a message where isMine is true -- see ChatRead's own
  // schema.prisma comment for why the cursor model replaced readAt.
  readByCounterpart: boolean;
  isMine: boolean;
  replyTo: MessageReplyPreview | null;
  reactions: ReactionSummary[];
};

const POST_REF_SELECT = { id: true, userId: true, title: true, imageUrl: true } as const;

// Phase P-6: hiddenByUserId === senderUserId means the sender deleted
// their own message (see schema.prisma's own comment on Message.hiddenAt)
// -- shown as "삭제된 메시지입니다.", distinct from an admin-hidden message.
const SELF_DELETED_MESSAGE_PLACEHOLDER = "삭제된 메시지입니다.";

function maskedContent(raw: { content: string; hiddenAt: Date | null; hiddenByUserId: number | null; senderUserId: number }): string {
  if (!raw.hiddenAt) return raw.content;
  return raw.hiddenByUserId === raw.senderUserId ? SELF_DELETED_MESSAGE_PLACEHOLDER : HIDDEN_MESSAGE_PLACEHOLDER;
}

// Phase D-3: shared by listMessages/sendMessage so both build the exact
// same reply-preview shape from the exact same raw shape (whatever a
// `replyToMessage: { select: MESSAGE_REPLY_SELECT }` include returns).
const MESSAGE_REPLY_SELECT = {
  id: true,
  content: true,
  imageUrl: true,
  hiddenAt: true,
  // Phase P-6: needed by maskedContent() to tell a self-delete apart from
  // an admin hide, same as the top-level message list below.
  hiddenByUserId: true,
  senderUserId: true,
  sender: { select: { nickname: true } },
} as const;

type RawReplyTarget = {
  id: number;
  content: string;
  imageUrl: string | null;
  hiddenAt: Date | null;
  hiddenByUserId: number | null;
  senderUserId: number;
  sender: { nickname: string | null };
};

function toReplyPreview(raw: RawReplyTarget | null): MessageReplyPreview | null {
  if (!raw) return null;
  return {
    id: raw.id,
    senderNickname: raw.sender.nickname,
    content: maskedContent(raw),
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
      initiatorUserId: true,
      counterpartUserId: true,
      organizationId: true,
      createdAt: true,
      directLostPost: { select: POST_REF_SELECT },
      directFoundPost: { select: POST_REF_SELECT },
    },
  });
}

// The single funnel point every permission check goes through (same role
// legacy's _chat_room_participant_ids had). A row with no initiator
// (shouldn't exist -- every row this app creates has one) is treated as
// not_found rather than crashing.
//
// Phase 12-11 §16/§20: now async -- an organization room's "who may
// access this" set is dynamic (whoever currently holds LEADER/ADMIN in
// that org), never a fixed value stored on the room at creation time. A
// MEMBER never appears here regardless of when they joined; an admin
// appointed after the room was created gains access the moment they're
// appointed, and one who steps down loses it the moment they do -- always
// re-derived fresh from OrganizationMember, same "never cached" rule
// organization/authz.ts's own module comment establishes for every other
// org-scoped permission check in this app.
async function participantIdsOf(room: ChatRoomRow): Promise<Set<number> | null> {
  if (room.initiatorUserId === null) return null;

  if (room.organizationId) {
    const managers = await prisma.organizationMember.findMany({
      where: {
        organizationId: room.organizationId,
        role: { in: [OrganizationRole.LEADER, OrganizationRole.ADMIN] },
      },
      select: { userId: true },
    });
    return new Set([room.initiatorUserId, ...managers.map((m) => m.userId)]);
  }

  if (room.counterpartUserId === null) return null;
  return new Set([room.counterpartUserId, room.initiatorUserId]);
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

// Phase H-7: publicId (nullable only for the fallback below) lets the chat
// header link the counterpart's name to /profile/[publicId], same as every
// other author-display site. The `?? {..., publicId: null}` branch only
// fires if the user row itself no longer exists (deleted account, if that
// ever becomes possible) -- there is no real profile to link to in that
// case, so callers treat a null publicId as "not linkable" rather than
// crashing.
async function resolveCounterpart(
  userId: number,
): Promise<{ id: number; nickname: string | null; publicId: string | null }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, nickname: true, publicId: true },
  });
  return user ?? { id: userId, nickname: null, publicId: null };
}

async function resolveDetailDTO(
  room: ChatRoomRow,
  requesterId: number,
): Promise<ChatRoomDetailDTO | null> {
  const directPost = room.directLostPost ?? room.directFoundPost;
  if (!directPost || room.initiatorUserId === null) return null;

  const post = {
    id: directPost.id,
    title: directPost.title,
    type: (room.directLostPost ? "lost" : "found") as PostType,
    imageUrl: directPost.imageUrl,
  };

  // Phase 12-11 §6/§13: an inquiry room's "other side" is the organization
  // itself -- never one particular User standing in for it. `inquirer` is
  // always the room's own initiator (the person who opened it), exposed
  // alongside `counterpart` so a viewer who *isn't* the inquirer (an org
  // admin looking at someone else's inquiry) can tell the two apart (see
  // ChatRoomDetailDTO.inquirer's own comment).
  if (room.organizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: room.organizationId },
      select: { id: true, name: true },
    });
    if (!organization) return null; // defensive -- Organization rows are never hard-deleted
    const inquirer = await resolveCounterpart(room.initiatorUserId);
    return {
      roomType: "organization",
      id: room.id,
      createdAt: room.createdAt,
      counterpart: { kind: "organization", id: organization.id, name: organization.name },
      inquirer,
      post,
    };
  }

  if (room.counterpartUserId === null) return null; // defensive -- every personal room has this set
  const otherPartyId = room.initiatorUserId === requesterId ? room.counterpartUserId : room.initiatorUserId;
  const counterpart = await resolveCounterpart(otherPartyId);
  return {
    roomType: "direct",
    id: room.id,
    createdAt: room.createdAt,
    counterpart: { kind: "user", ...counterpart },
    inquirer: null,
    post,
  };
}

// Phase 10: get-or-create a *direct* ChatRoom between requester (the
// initiator/viewer) and a LostPost's or FoundPost's current author. Lets a
// board viewer message a post's author straight away. Mirrors legacy
// get_or_create_direct_chat_room() exactly, including validation order:
// 1) requester not suspended, 2) post exists, 3) requester isn't the
// post's own author (no self-chat). Idempotent via the DB's own
// idx_chatroom_direct_{lost,found}_unique constraint (already present in
// schema.prisma/the applied migration -- see the Phase 10 report; no
// schema change needed for this): a second call for the same (post,
// initiator) pair returns the existing room, and a concurrent create race
// is resolved by re-fetching the winner rather than erroring.
//
// Phase J-2: this is now the *only* way a ChatRoom is ever created -- the
// Match-mediated variant (getOrCreateChatRoomForMatch) went with the Match
// domain. Nothing about this function itself changed.
//
// Phase 12-9 §3/§4: `commentId` (optional) lets the counterpart be that
// comment's own actual author instead of the post's current author --
// only ever a comment id, resolved and re-validated here, never a raw
// userId the client could claim ("chat with user 123"). §4's own
// requirement: an organization-attributed comment's real chat recipient
// is still the comment's real authorUserId, never the organization --
// authorUserId is exactly what's read below regardless of the comment's
// own organizationId, so this falls out automatically without any
// special-casing.
//
// Phase 12-11 §0/§18: when there's no commentId and the post itself is
// organization-attributed (post.organizationId set), this is no longer a
// personal chat at all -- delegates to getOrCreateOrganizationChatRoom
// rather than ever treating post.userId (the real, usually-hidden author)
// as the chat counterpart. A comment-chat request (commentId present)
// always stays personal regardless of the *post's* own organizationId --
// §4's existing rule that a comment's real author is always the real chat
// recipient is untouched by this phase.
export async function getOrCreateDirectChatRoom(
  postType: PostType,
  postId: number,
  requester: User,
  commentId?: number,
): Promise<ChatMutationResult<ChatRoomDetailDTO>> {
  if (isCurrentlySuspended(requester)) {
    return { kind: "forbidden", reason: "suspended" };
  }

  const post =
    postType === "lost"
      ? await prisma.lostPost.findUnique({
          where: { id: postId },
          select: { id: true, userId: true, organizationId: true },
        })
      : await prisma.foundPost.findUnique({
          where: { id: postId },
          select: { id: true, userId: true, organizationId: true },
        });
  // A missing post covers both "never existed" and "deleted" -- the row
  // simply isn't found either way, no separate check needed.
  if (!post) return { kind: "not_found" };

  if (commentId === undefined && post.organizationId) {
    return getOrCreateOrganizationChatRoom(postType, postId, requester, post.organizationId);
  }

  let counterpartUserId = post.userId;
  if (commentId !== undefined) {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { authorUserId: true, lostPostId: true, foundPostId: true },
    });
    // Must actually be a comment on *this* post -- a commentId from a
    // different post (typo, stale client state, or a deliberately forged
    // value) is rejected the same way a nonexistent one is, never
    // silently falling back to "chat with the post author" instead.
    const belongsToThisPost =
      comment !== null && (postType === "lost" ? comment.lostPostId === postId : comment.foundPostId === postId);
    if (!belongsToThisPost) return { kind: "not_found" };
    counterpartUserId = comment.authorUserId;
  }
  if (counterpartUserId === requester.id) return { kind: "forbidden", reason: "self" };

  // The compound-unique field name Prisma generates is derived from the
  // column list itself (directLostPostId_initiatorUserId_counterpartUserId),
  // NOT from the @@unique's `map` name in schema.prisma (that only names
  // the actual SQL index/constraint) -- verified against the generated
  // client types.
  const directColumn = postType === "lost" ? ({ directLostPostId: postId } as const) : ({ directFoundPostId: postId } as const);
  const uniqueWhere =
    postType === "lost"
      ? {
          directLostPostId_initiatorUserId_counterpartUserId: {
            directLostPostId: postId,
            initiatorUserId: requester.id,
            counterpartUserId,
          },
        }
      : {
          directFoundPostId_initiatorUserId_counterpartUserId: {
            directFoundPostId: postId,
            initiatorUserId: requester.id,
            counterpartUserId,
          },
        };

  const existing = await prisma.chatRoom.findUnique({ where: uniqueWhere });
  if (existing) {
    const room = await findChatRoomRow(existing.id);
    const dto = room && (await resolveDetailDTO(room, requester.id));
    if (dto) return { kind: "ok", data: dto };
  }

  let createdId: number;
  try {
    const created = await prisma.chatRoom.create({
      data: { ...directColumn, initiatorUserId: requester.id, counterpartUserId },
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

// Phase 12-11 §0/§6/§7/§9/§10/§17/§19: get-or-create an *organization*
// inquiry ChatRoom -- the "단체에 문의하기" flow. `organizationId` is always
// the caller's own already-resolved value (getOrCreateDirectChatRoom reads
// it from the post it already fetched), never re-derived from a raw
// client input, so there's no way to open an inquiry room "at" an
// organizationId that doesn't actually match the post in question.
//
// Room identity is (post, initiator, organization) -- §7's own policy:
// the same user inquiring about the same organization through two
// *different* posts gets two separate rooms (their contexts shouldn't
// mix), but re-clicking "단체에 문의하기" on the same post reuses the
// existing room, exactly mirroring getOrCreateDirectChatRoom's own
// idempotency (same unique-constraint-then-P2002-recovery shape).
export async function getOrCreateOrganizationChatRoom(
  postType: PostType,
  postId: number,
  requester: User,
  organizationId: number,
): Promise<ChatMutationResult<ChatRoomDetailDTO>> {
  if (isCurrentlySuspended(requester)) {
    return { kind: "forbidden", reason: "suspended" };
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { status: true },
  });
  if (!organization) return { kind: "not_found" };
  // §17: a closed (INACTIVE) organization can't receive *new* inquiries --
  // existing rooms into it stay fully readable (this check only runs at
  // creation time, never on read/send paths).
  if (organization.status !== OrganizationStatus.ACTIVE) return { kind: "inactive_organization" };

  // §19: a LEADER/ADMIN of this exact organization inquiring about their
  // own organization is never meaningful (they'd just be notifying
  // themselves) -- checked here, re-derived fresh from the DB, never
  // trusting the client's own view of "am I a manager here" the way every
  // other org-authz check in this app already re-derives role state (see
  // organization/authz.ts's own module comment).
  const membership = await getMembership(requester.id, organizationId);
  if (membership?.role === OrganizationRole.LEADER || membership?.role === OrganizationRole.ADMIN) {
    return { kind: "forbidden", reason: "organization_manager" };
  }

  const directColumn = postType === "lost" ? ({ directLostPostId: postId } as const) : ({ directFoundPostId: postId } as const);
  const uniqueWhere =
    postType === "lost"
      ? {
          directLostPostId_initiatorUserId_organizationId: {
            directLostPostId: postId,
            initiatorUserId: requester.id,
            organizationId,
          },
        }
      : {
          directFoundPostId_initiatorUserId_organizationId: {
            directFoundPostId: postId,
            initiatorUserId: requester.id,
            organizationId,
          },
        };

  const existing = await prisma.chatRoom.findUnique({ where: uniqueWhere });
  if (existing) {
    const room = await findChatRoomRow(existing.id);
    const dto = room && (await resolveDetailDTO(room, requester.id));
    if (dto) return { kind: "ok", data: dto };
  }

  let createdId: number;
  try {
    // Phase 12-11 §9/§12: the "새 문의" notification fan-out happens inside
    // the same transaction as the room INSERT, and only on this genuinely-
    // new-room path -- never on the "existing room reused" branch above,
    // and never again on a later message in this same room (see
    // sendMessage's own comment on why per-message admin notifications
    // don't exist). A concurrent create race (P2002 below) means the loser
    // never reaches this transaction at all, so no duplicate fan-out is
    // possible there either.
    createdId = await prisma.$transaction(async (tx) => {
      const created = await tx.chatRoom.create({
        data: { ...directColumn, initiatorUserId: requester.id, organizationId },
        select: { id: true },
      });
      await fanOutToOrganizationManagers(tx, {
        organizationId,
        excludeUserId: requester.id,
        type: NotificationType.ORGANIZATION_CHAT_RECEIVED,
        title: "새로운 단체 문의가 도착했습니다",
        content: `${requester.nickname ?? "사용자"}님이 단체에 문의를 남겼습니다.`,
        relatedType: "organization_chat_room",
        relatedId: created.id,
      });
      return created.id;
    });
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
  if (!dto) throw new Error(`Failed to load organization ChatRoom ${createdId} for ${postType} post ${postId}`);
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
  const participantIds = await participantIdsOf(room);
  if (!participantIds) return { kind: "not_found" };
  if (!participantIds.has(requesterId)) return { kind: "forbidden" };

  const dto = await resolveDetailDTO(room, requesterId);
  if (!dto) return { kind: "not_found" };
  return { kind: "ok", data: dto };
}

export type AdminChatMessageDTO = {
  id: number;
  senderUserId: number;
  senderNickname: string | null;
  content: string;
  imageUrl: string | null;
  isDeleted: boolean;
  createdAt: Date;
};

export type AdminChatRoomDTO = {
  id: number;
  post: { id: number; type: PostType; title: string };
  participants: { id: number; nickname: string | null; publicId: string | null }[];
  messages: AdminChatMessageDTO[];
};

// Phase 11-1: admin-only, read-only room view for /admin/reports/[id]'s
// "채팅방으로 이동" link (Phase 11 audit's P0 finding -- a message-target
// report had no way to see the reported message's surrounding context).
// Deliberately NOT a variant of getChatRoomForUser above -- that
// function's participant-only gate is untouched (this phase's own "일반
// 사용자의 채팅 권한을 변경하지 않는다"), and resolveDetailDTO's
// "counterpart relative to requesterId" shape has no meaning for a third
// party who isn't a participant at all. This lists every current
// participant plainly instead (for an organization room, that's the
// inquirer plus every current LEADER/ADMIN -- same set participantIdsOf
// derives everywhere else), and every message with its own sender
// attached -- deliberately no reply preview/reaction/read-receipt data,
// since none of that is meaningful for a non-participant and this link
// only exists to give an admin surrounding context, not a feature-
// complete chat client (no compose/reply/react/edit/delete capability is
// exposed here). Performs no authorization itself -- same convention as
// getMessage()'s own comment -- the caller (the admin page) gates with
// requireAdmin().
export async function getChatRoomForAdmin(chatRoomId: number): Promise<AdminChatRoomDTO | null> {
  const room = await findChatRoomRow(chatRoomId);
  if (!room) return null;
  const participantIds = await participantIdsOf(room);
  const directPost = room.directLostPost ?? room.directFoundPost;
  if (!participantIds || !directPost) return null;

  const [participants, rows] = await Promise.all([
    Promise.all([...participantIds].map((id) => resolveCounterpart(id))),
    prisma.message.findMany({
      where: { chatRoomId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { sender: { select: { nickname: true } } },
    }),
  ]);

  return {
    id: room.id,
    post: { id: directPost.id, type: room.directLostPost ? "lost" : "found", title: directPost.title },
    participants,
    messages: rows.map((m) => ({
      id: m.id,
      senderUserId: m.senderUserId,
      senderNickname: m.sender.nickname,
      content: maskedContent(m),
      imageUrl: m.hiddenAt ? null : m.imageUrl,
      isDeleted: Boolean(m.hiddenAt),
      createdAt: m.createdAt,
    })),
  };
}

// Every ChatRoom the user participates in -- as a personal room's
// initiator/counterpart, or (Phase 12-11) as the inquirer of one of their
// own organization inquiries, or as a current LEADER/ADMIN of an
// organization that has inquiry rooms -- most-recently-active first,
// mirroring legacy list_chat_rooms_by_user(). Phase J-2: this used to
// union a second query for Match-based rooms; with Match gone there was
// only the one (direct) shape left, until Phase 12-11 added the
// organization shape alongside it.
export async function listChatRoomsForUser(requesterId: number): Promise<ChatRoomListItemDTO[]> {
  // Phase 12-11: which organizations this user currently manages -- fresh
  // on every call (same "never cached" rule as participantIdsOf), used
  // only to widen the room WHERE clause below so an admin's own inquiry
  // rooms show up in their chat list without a second round-trip per room.
  const managedOrgs = await prisma.organizationMember.findMany({
    where: { userId: requesterId, role: { in: [OrganizationRole.LEADER, OrganizationRole.ADMIN] } },
    select: { organizationId: true },
  });
  const managedOrgIds = managedOrgs.map((m) => m.organizationId);

  const rooms = await prisma.chatRoom.findMany({
    where: {
      // Phase 12-9: filters on the two stored participant columns directly
      // now, rather than joining through directLostPost/directFoundPost's
      // *current* owner -- see ChatRoom.counterpartUserId's own comment.
      // Phase 12-11: OR'd with "an organization I currently manage" so an
      // admin's inbox includes every inquiry room for their org(s), not
      // just ones they personally opened.
      OR: [
        { initiatorUserId: requesterId },
        { counterpartUserId: requesterId },
        ...(managedOrgIds.length > 0 ? [{ organizationId: { in: managedOrgIds } }] : []),
      ],
    },
    select: {
      id: true,
      initiatorUserId: true,
      counterpartUserId: true,
      organizationId: true,
      createdAt: true,
      directLostPost: { select: POST_REF_SELECT },
      directFoundPost: { select: POST_REF_SELECT },
      messages: {
        orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
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
  const room = await findChatRoomRow(chatRoomId);
  if (!room) return { kind: "not_found" };
  const participantIds = await participantIdsOf(room);
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

  // Phase N: one lookup for the *other* participant's read cursor (never
  // the requester's own -- see MessageDTO.readByCounterpart's own
  // comment), reused for every message on this page rather than a
  // per-message query. Phase 12-11: for an organization room this "other"
  // id is just whichever manager/initiator isn't the requester (picked
  // arbitrarily among several possible managers) -- read-receipt display
  // for a many-manager inquiry room is inherently approximate (there's no
  // single "the other person"), same limitation this DTO already has for
  // any room with more than two possible viewers; it never blocks or
  // breaks the message list itself, only the per-message "읽음" hint.
  // Wrapped defensively (unlike every other ChatRead access in this file):
  // this is the one call on the *read* path, reachable the instant this
  // code ships, before the ChatRead migration is necessarily live in every
  // environment (this phase's own spec: migration not applied yet) --
  // falling back to "nothing read yet" degrades to an under-informative
  // read indicator, never a broken message list.
  const counterpartId = [...participantIds].find((id) => id !== requesterId) ?? requesterId;
  let counterpartLastRead = 0;
  try {
    const counterpartRead = await prisma.chatRead.findUnique({
      where: { chatRoomId_userId: { chatRoomId, userId: counterpartId } },
      select: { lastReadMessageId: true },
    });
    counterpartLastRead = counterpartRead?.lastReadMessageId ?? 0;
  } catch (error) {
    console.error("Failed to read chat read-cursor:", error);
  }

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
    content: maskedContent(m),
    // A hidden message's image is masked too -- same "real content never
    // altered, only masked for display" rule as `content` above (an admin
    // hiding a message shouldn't leave its photo visible while its text
    // is replaced).
    imageUrl: m.hiddenAt ? null : m.imageUrl,
    createdAt: m.createdAt,
    // A hidden/deleted message never shows an "edited" mark -- its real
    // content is masked either way, so "was it edited before being
    // deleted" isn't meaningful to surface.
    editedAt: m.hiddenAt ? null : m.editedAt,
    isDeleted: Boolean(m.hiddenAt),
    readByCounterpart: m.id <= counterpartLastRead,
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

// Phase N: replaces markMessagesAsRead()'s bulk-UPDATE-every-unread-
// message approach with a single upsert of requesterId's own read cursor
// in this room, advanced to the room's current latest message id -- see
// ChatRead's own schema.prisma comment for the full reasoning. Called
// from the exact same call site markMessagesAsRead() used to be (GET
// /api/chat/[id]/messages, "viewing the room marks it read"), so the
// *behavior* (when reading counts as "read") is unchanged, only how it's
// stored. A room with no messages yet is a no-op -- nothing to point the
// cursor at, and no ChatRead row is written (see that model's own comment
// on why lastReadMessageId's nullability isn't actually exercised by this
// function).
export async function markChatRoomRead(
  chatRoomId: number,
  requesterId: number,
): Promise<ChatMutationResult<{ lastReadMessageId: number | null }>> {
  const room = await findChatRoomRow(chatRoomId);
  if (!room) return { kind: "not_found" };
  const participantIds = await participantIdsOf(room);
  if (!participantIds) return { kind: "not_found" };
  if (!participantIds.has(requesterId)) return { kind: "forbidden" };

  const latest = await prisma.message.findFirst({
    where: { chatRoomId },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  if (!latest) return { kind: "ok", data: { lastReadMessageId: null } };

  const read = await prisma.chatRead.upsert({
    where: { chatRoomId_userId: { chatRoomId, userId: requesterId } },
    create: { chatRoomId, userId: requesterId, lastReadMessageId: latest.id },
    update: { lastReadMessageId: latest.id },
  });

  // Best-effort, after the write already committed -- see
  // realtimeAdmin.ts's own comment on why this payload is safe to send on
  // an otherwise-unauthenticated channel (just two numeric ids, never
  // message content).
  void broadcastChatEvent(chatRoomId, {
    event: "read",
    payload: { userId: requesterId, lastReadMessageId: read.lastReadMessageId! },
  });

  return { kind: "ok", data: { lastReadMessageId: read.lastReadMessageId } };
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
  const participantIds = await participantIdsOf(room);
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
//
// Phase 12-11 §12: for an organization room there is no single fixed
// "other participant" to notify the way a personal room has -- and this
// phase's own spec explicitly forbids fanning a MESSAGE notification out
// to every manager on every message (that's a "new inquiry" event,
// already handled once at room-creation time, not a per-message one).
// Only the inquirer ever gets a message notification here, and only when
// the *sender* is a manager replying to them -- if the inquirer sends a
// message, nobody is notified via this path (mirrors "an admin should not
// get pinged for every line the inquirer types", which fan-out-to-
// managers would otherwise do).
//
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
  const participantIds = await participantIdsOf(room);
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

  // Phase 12-11: an organization room's notification target is always
  // "the inquirer, but only if a manager is the one sending" -- computed
  // directly from room.initiatorUserId rather than from participantIds
  // (which, for an org room, can hold several managers with no single
  // "the other one"). A personal room keeps its original computation
  // unchanged: participantIds is always exactly the sender + the one
  // other participant (a room's initiator/counterpart pair are guaranteed
  // distinct at creation time -- see getOrCreateDirectChatRoom()'s
  // self-chat check), so the `?? sender.id` fallback there is defensive
  // only.
  let notifyUserId: number | null = null;
  if (room.organizationId) {
    if (room.initiatorUserId !== null && sender.id !== room.initiatorUserId) {
      notifyUserId = room.initiatorUserId;
    }
  } else {
    const otherUserId = [...participantIds].find((id) => id !== sender.id) ?? sender.id;
    notifyUserId = otherUserId !== sender.id ? otherUserId : null;
  }

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

    if (notifyUserId !== null) {
      await tx.notification.create({
        data: {
          userId: notifyUserId,
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

  // Phase N: best-effort, after the transaction already committed -- see
  // realtimeAdmin.ts's own comment. The other participant's (and, subject
  // to the harmless self-echo noted in ChatThread.tsx, the sender's own)
  // subscribed client re-fetches the real content through the existing
  // authorized GET endpoint; this push only ever carries the new
  // message's bare id.
  void broadcastChatEvent(chatRoomId, { event: "message", payload: { messageId: message.id } });

  return {
    kind: "ok",
    data: {
      id: message.id,
      senderUserId: message.senderUserId,
      senderNickname: message.sender.nickname,
      content: message.content,
      imageUrl: message.imageUrl,
      createdAt: message.createdAt,
      editedAt: null, // freshly created -- never edited yet
      isDeleted: false,
      // Freshly created -- the counterpart hasn't had a chance to read it yet.
      readByCounterpart: false,
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
  const participantIds = await participantIdsOf(room);
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

  // Phase N: best-effort, after the write already committed -- see
  // realtimeAdmin.ts's own comment. Deliberately just the message id, not
  // the reaction summary itself: reactedByMe is relative to whoever's
  // asking (see ReactionSummary's own comment), so a summary computed for
  // *this* requester couldn't be reused as-is by the other participant's
  // client anyway -- it re-fetches through the existing GET endpoint,
  // same as a "message" event's client-side handling.
  void broadcastChatEvent(chatRoomId, { event: "reaction", payload: { messageId } });

  return { kind: "ok", data: { messageId, reactions: summarizeReactions(rows, requester.id) } };
}

// Phase P-6: edits the sender's own message text -- strictly self-only,
// no admin override (unlike deleteMessage below): admins moderate by
// hiding content, never by rewriting someone else's words. Re-validates
// room membership and the (messageId, chatRoomId) pairing the same way
// every other per-message mutation here does (toggleMessageReaction,
// sendMessage's replyToMessageId). A hidden/deleted message can't be
// edited -- there's nothing left to edit once its content is masked.
export async function editMessage(
  chatRoomId: number,
  messageId: number,
  requesterId: number,
  content: string,
): Promise<ChatMutationResult<MessageDTO>> {
  const room = await findChatRoomRow(chatRoomId);
  if (!room) return { kind: "not_found" };
  const participantIds = await participantIdsOf(room);
  if (!participantIds) return { kind: "not_found" };
  if (!participantIds.has(requesterId)) return { kind: "forbidden" };

  const existing = await prisma.message.findUnique({ where: { id: messageId } });
  if (!existing || existing.chatRoomId !== chatRoomId) return { kind: "invalid_message" };
  if (existing.hiddenAt) return { kind: "invalid_message" };
  if (existing.senderUserId !== requesterId) return { kind: "forbidden" };

  const trimmed = content.trim();
  if (!trimmed) return { kind: "invalid_content" };

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { content: trimmed, editedAt: new Date() },
    include: { sender: { select: { nickname: true } }, replyToMessage: { select: MESSAGE_REPLY_SELECT } },
  });

  // Phase P-6: reuses the exact same "message" broadcast event sendMessage
  // already uses (never a new event type) -- ChatThread.tsx's syncLatest()
  // already re-fetches-and-upserts-by-id on that event, which is exactly
  // "replace this id's row with its fresh copy" -- the correct behavior
  // for an edit too, with zero changes needed to useChatRoomRealtime.ts.
  void broadcastChatEvent(chatRoomId, { event: "message", payload: { messageId } });

  const reactionRows = await prisma.messageReaction.findMany({
    where: { messageId },
    select: { emoji: true, userId: true },
  });

  return {
    kind: "ok",
    data: {
      id: updated.id,
      senderUserId: updated.senderUserId,
      senderNickname: updated.sender.nickname,
      content: updated.content,
      imageUrl: updated.imageUrl,
      createdAt: updated.createdAt,
      editedAt: updated.editedAt,
      isDeleted: false, // editMessage already rejects editing a hidden/deleted message above
      readByCounterpart: false, // caller (the sender themselves) re-fetches the real list right after
      isMine: true,
      replyTo: toReplyPreview(updated.replyToMessage),
      reactions: summarizeReactions(reactionRows, requesterId),
    },
  };
}

// Phase P-6: soft-deletes ("삭제") the sender's own message, reusing the
// existing hidden_at/hidden_by_user_id columns admin moderation already
// uses (see schema.prisma's own comment) rather than a new column or a
// hard DELETE -- no new deletion policy, just a second way to reach the
// same existing state. Also allows an admin to delete any message
// directly, mirroring posts/service.ts's deleteLostPost/deleteFoundPost's
// own `asAdmin` bypass precedent (existing admin capability, not a new
// one) -- this is separate from, and doesn't change, the existing report
// -> HIDE_MESSAGE moderation flow.
export async function deleteMessage(
  chatRoomId: number,
  messageId: number,
  requester: User,
): Promise<ChatMutationResult<{ messageId: number }>> {
  const room = await findChatRoomRow(chatRoomId);
  if (!room) return { kind: "not_found" };
  const participantIds = await participantIdsOf(room);
  if (!participantIds) return { kind: "not_found" };
  // An admin bypasses the membership gate too -- same as the report ->
  // HIDE_MESSAGE flow, which never required the processing admin to be a
  // participant of the room either. Ordinary (non-admin) callers must
  // still be a participant, checked here same as every other per-message
  // mutation in this file.
  if (!participantIds.has(requester.id) && !requester.isAdmin) return { kind: "forbidden" };

  const existing = await prisma.message.findUnique({
    where: { id: messageId },
    select: { chatRoomId: true, senderUserId: true, hiddenAt: true, imageUrl: true },
  });
  if (!existing || existing.chatRoomId !== chatRoomId) return { kind: "invalid_message" };
  if (existing.senderUserId !== requester.id && !requester.isAdmin) {
    return { kind: "forbidden" };
  }

  // Idempotent: a message that's already hidden (whether by this same
  // action, a previous one, or admin moderation) simply stays hidden --
  // never an error, matching toggleMessageReaction's own "recover, don't
  // reject" handling of a redundant action.
  if (!existing.hiddenAt) {
    // Phase 10B: `hiddenByUserId === senderUserId` (i.e. the sender is
    // deleting their own message, whether or not they happen to also be
    // an admin) is the same self-delete disambiguation maskedContent()
    // already uses to pick the "삭제된 메시지입니다." placeholder over the
    // admin-hidden one. Only that case purges the Storage image: an admin
    // deleting *someone else's* message (this same bypass path) or the
    // separate moderation/service.ts HIDE_MESSAGE flow both leave
    // `hiddenByUserId !== senderUserId`, and their images are
    // deliberately preserved -- the reported photo may still be needed as
    // evidence for a later review, the same reason Report/ModerationAction
    // rows themselves are never purged (see Phase 10A's retention policy).
    const isSelfDelete = existing.senderUserId === requester.id;
    const imageToDelete = isSelfDelete ? existing.imageUrl : null;

    // DB write first, Storage cleanup after -- same order/reasoning as
    // posts/service.ts's deleteLostPost: the message is already hidden in
    // the DB either way, so a Storage failure here is only logged (see
    // deleteObjectSafely's own try/catch), never surfaced as a failed
    // delete or left inconsistent with what's displayed (imageUrl: null
    // and hiddenAt together are what MessageDTO/hasImage already key off).
    await prisma.message.update({
      where: { id: messageId },
      data: {
        hiddenAt: new Date(),
        hiddenByUserId: requester.id,
        hiddenReason: null,
        ...(imageToDelete ? { imageUrl: null } : {}),
      },
    });
    if (imageToDelete) await deleteObjectSafely(imageToDelete);
    void broadcastChatEvent(chatRoomId, { event: "message", payload: { messageId } });
  }

  return { kind: "ok", data: { messageId } };
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

// Phase 17: chat tab's unread badge (Navigation). Reuses the same
// room-scoping logic listChatRoomsForUser() uses (an organization room
// counts for a current LEADER/ADMIN of it too, per Phase 12-11) to find
// every room this user can see, then counts unread messages across all of
// them via one raw query. A hidden message (Report/ModerationAction) is
// still counted -- the notification badge signals "something happened
// here", not "there's readable new content"; opening the room is what
// actually clears it via markChatRoomRead().
//
// Phase N: the unread threshold is now requesterId's own ChatRead cursor,
// which varies per room -- Prisma's query builder has no way to express
// "join each message against a different threshold row per room" in one
// call, so this is a single raw query (LEFT JOIN so a room with no
// ChatRead row yet -- never opened -- correctly treats every message in
// it as unread via COALESCE(..., 0)) rather than either N+1 per-room
// queries or a second round trip to fetch every cursor first.
export async function countUnreadMessagesForUser(requesterId: number): Promise<number> {
  const managedOrgs = await prisma.organizationMember.findMany({
    where: { userId: requesterId, role: { in: [OrganizationRole.LEADER, OrganizationRole.ADMIN] } },
    select: { organizationId: true },
  });
  const managedOrgIds = managedOrgs.map((m) => m.organizationId);

  const rooms = await prisma.chatRoom.findMany({
    where: {
      OR: [
        { initiatorUserId: requesterId },
        { counterpartUserId: requesterId },
        ...(managedOrgIds.length > 0 ? [{ organizationId: { in: managedOrgIds } }] : []),
      ],
    },
    select: { id: true },
  });
  const roomIds = rooms.map((r) => r.id);
  if (roomIds.length === 0) return 0;

  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "Message" m
    LEFT JOIN "ChatRead" cr ON cr.chat_room_id = m.chat_room_id AND cr.user_id = ${requesterId}
    WHERE m.chat_room_id = ANY(${roomIds})
      AND m.sender_user_id != ${requesterId}
      AND m.id > COALESCE(cr.last_read_message_id, 0)
  `;
  return Number(rows[0]?.count ?? 0);
}
