import { after } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { broadcastChatEvent } from "@/lib/chat/realtimeAdmin";

// 채팅방에서 찾음 완료: the author marks the post done from one of its chat
// rooms, and that room's other person becomes the return partner -- nobody
// is asked to pick anyone. The status change, its history row and the
// PostReturn row are written in one transaction with the post row locked,
// and the partial unique index uq_postreturn_active (one active return per
// post) settles any race, so two rooms can never both be recorded.
//
// Roles come from the post type, not from who pressed the button:
//   lost  -- author = owner (got it back), partner = finder
//   found -- author = finder, partner = owner
// A completion from the post page records no return (no partner is known).

export type ReturnRoles = { ownerUserId: number; finderUserId: number };
export function returnRoles(postType: "lost" | "found", authorId: number, partnerId: number): ReturnRoles {
  return postType === "lost" ? { ownerUserId: authorId, finderUserId: partnerId } : { ownerUserId: partnerId, finderUserId: authorId };
}

export type ChatRoomPostState = {
  postType: "lost" | "found";
  postId: number;
  authorId: number;
  completed: boolean;
  // the other person in this direct room, seen from `viewerId`
  partnerId: number | null;
};

const DONE = { lost: "FOUND", found: "COMPLETED" } as const;
const OPEN = { lost: "SEARCHING", found: "KEEPING" } as const;
const LABEL = { lost: { FOUND: "찾음", SEARCHING: "찾는 중" }, found: { COMPLETED: "완료", KEEPING: "보관 중" } } as const;

type Db = Prisma.TransactionClient | typeof prisma;

// The post a direct room is about and the viewer's partner in it (null: an
// organization room, a room without a post, or a viewer outside the room).
export async function chatRoomPostState(db: Db, chatRoomId: number, viewerId: number): Promise<ChatRoomPostState | null> {
  const room = await db.chatRoom.findUnique({
    where: { id: chatRoomId },
    select: { organizationId: true, initiatorUserId: true, counterpartUserId: true, directLostPostId: true, directFoundPostId: true },
  });
  if (!room || room.organizationId !== null || room.initiatorUserId === null || room.counterpartUserId === null) return null;
  const people = [room.initiatorUserId, room.counterpartUserId];
  if (!people.includes(viewerId)) return null;
  const partnerId = people.find((id) => id !== viewerId) ?? null;
  if (room.directLostPostId !== null) {
    const post = await db.lostPost.findUnique({ where: { id: room.directLostPostId }, select: { userId: true, status: true } });
    return post ? { postType: "lost", postId: room.directLostPostId, authorId: post.userId, completed: post.status === DONE.lost, partnerId } : null;
  }
  if (room.directFoundPostId !== null) {
    const post = await db.foundPost.findUnique({ where: { id: room.directFoundPostId }, select: { userId: true, status: true } });
    return post ? { postType: "found", postId: room.directFoundPostId, authorId: post.userId, completed: post.status === DONE.found, partnerId } : null;
  }
  return null;
}

// Whether the viewer may press 찾음 완료 in this room (the UI hint; the
// server re-checks everything in completeFromChat).
export function canCompleteFromChat(state: ChatRoomPostState | null, viewerId: number): boolean {
  return !!state && !state.completed && state.authorId === viewerId && state.partnerId !== null && state.partnerId !== viewerId;
}

export type CompleteFromChatResult =
  | { kind: "ok"; postType: "lost" | "found"; postId: number; returnId: number; ownerUserId: number; finderUserId: number }
  | { kind: "not_found" }
  | { kind: "forbidden"; reason: "not_author" | "suspended" | "partner_unavailable" }
  | { kind: "already_completed" };

export async function completeFromChat(user: { id: number; isSuspended: boolean; suspendedUntil: Date | null }, chatRoomId: number): Promise<CompleteFromChatResult> {
  if (isCurrentlySuspended(user)) return { kind: "forbidden", reason: "suspended" };
  let result: CompleteFromChatResult;
  try {
    result = await prisma.$transaction(async (tx) => {
      const state = await chatRoomPostState(tx, chatRoomId, user.id);
      if (!state || state.partnerId === null) return { kind: "not_found" } as const;
      if (state.authorId !== user.id) return { kind: "forbidden", reason: "not_author" } as const;
      if (state.partnerId === user.id) return { kind: "forbidden", reason: "partner_unavailable" } as const;
      const table = state.postType === "lost" ? Prisma.raw(`"LostPost"`) : Prisma.raw(`"FoundPost"`);
      // lock the post, then re-read its status under the lock
      const locked = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM ${table} WHERE id = ${state.postId} FOR UPDATE`;
      if (!locked[0]) return { kind: "not_found" } as const;
      const fromLabel = locked[0].status;
      const doneLabel = state.postType === "lost" ? LABEL.lost.FOUND : LABEL.found.COMPLETED;
      if (fromLabel === doneLabel) return { kind: "already_completed" } as const;
      const partner = await tx.user.findUnique({ where: { id: state.partnerId }, select: { withdrawnAt: true } });
      if (!partner || partner.withdrawnAt) return { kind: "forbidden", reason: "partner_unavailable" } as const;
      if (state.postType === "lost") await tx.lostPost.update({ where: { id: state.postId }, data: { status: DONE.lost } });
      else await tx.foundPost.update({ where: { id: state.postId }, data: { status: DONE.found } });
      await tx.postStatusChange.create({
        data: { postType: state.postType, postId: state.postId, fromStatus: fromLabel, toStatus: doneLabel, changedByUserId: user.id, action: "owner_status", reason: "chat" },
      });
      const roles = returnRoles(state.postType, state.authorId, state.partnerId);
      const row = await tx.postReturn.create({
        data: { postType: state.postType, postId: state.postId, chatRoomId, completedByUserId: user.id, ...roles },
      });
      return { kind: "ok", postType: state.postType, postId: state.postId, returnId: row.id, ...roles } as const;
    });
  } catch (error) {
    // the active-return unique index: another request completed it first
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { kind: "already_completed" };
    throw error;
  }
  if (result.kind === "ok") {
    const { postType, postId } = result;
    after(() => broadcastPostStatus(postType, postId));
  }
  return result;
}

// Undoing a completion (post page / institution reopen) ends the active
// return; the row stays, and notes already sent keep pointing at it.
export async function revokeActiveReturn(tx: Prisma.TransactionClient, postType: "lost" | "found", postId: number): Promise<void> {
  await tx.postReturn.updateMany({ where: { postType, postId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function activeReturnOf(db: Db, postType: "lost" | "found", postId: number) {
  return db.postReturn.findFirst({ where: { postType, postId, revokedAt: null } });
}

// Tell every open room of the post to re-read its state.
export async function broadcastPostStatus(postType: "lost" | "found", postId: number): Promise<void> {
  const rooms = await prisma.chatRoom.findMany({ where: postType === "lost" ? { directLostPostId: postId } : { directFoundPostId: postId }, select: { id: true } });
  await Promise.all(rooms.map((r) => broadcastChatEvent(r.id, { event: "post_status", payload: { postType, postId } })));
}

export type RoomStatusEvent = { id: number; at: string; kind: "completed" | "reopened" };

// Status lines shown inside a chat room: the post's own completions and
// reopenings (history rows, never chat messages -- they count for nothing).
export async function roomStatusEvents(postType: "lost" | "found", postId: number): Promise<RoomStatusEvent[]> {
  const done = postType === "lost" ? LABEL.lost.FOUND : LABEL.found.COMPLETED;
  const rows = await prisma.postStatusChange.findMany({
    where: { postType, postId, action: { in: ["owner_status", "complete", "reopen"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, createdAt: true, toStatus: true, fromStatus: true },
    take: 100,
  });
  return rows.filter((r) => r.fromStatus !== r.toStatus).map((r) => ({ id: r.id, at: r.createdAt.toISOString(), kind: r.toStatus === done ? "completed" : "reopened" }));
}

export { OPEN as OPEN_STATUS };
