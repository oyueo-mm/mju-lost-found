import { prisma } from "@/lib/db/prisma";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { NotificationType, Prisma, ReportStatus, ReportTargetType } from "@/generated/prisma/client";
import { notifyUser } from "@/lib/notification/recipients";
import { chatRoomPostState } from "@/lib/posts/returns";
import { looksPersonal, THANK_NOTES_PER_DAY, thankTarget, validateThankBody } from "./eligibility";

// 감사 쪽지 storage and permissions. Every write re-derives who may thank
// whom from the database (eligibility.ts) -- the client names only the post
// and the text, never the sender or the receiver. Notes are private to their
// receiver until the receiver publishes them; a published note is shown
// without its sender. A note's receiver gets an in-app notification (never a
// web push).

type PostType = "lost" | "found";
type Db = Prisma.TransactionClient | typeof prisma;

async function loadContext(db: Db, viewerId: number, postType: PostType, postId: number) {
  const post =
    postType === "lost"
      ? await db.lostPost.findUnique({ where: { id: postId }, select: { status: true } })
      : await db.foundPost.findUnique({ where: { id: postId }, select: { status: true } });
  if (!post) return null;
  const completed = postType === "lost" ? post.status === "FOUND" : post.status === "COMPLETED";
  const ret = await db.postReturn.findFirst({ where: { postType, postId, revokedAt: null }, orderBy: { id: "desc" } });
  const writers = ret?.chatRoomId
    ? (await db.message.groupBy({ by: ["senderUserId"], where: { chatRoomId: ret.chatRoomId } })).map((w) => w.senderUserId)
    : [];
  const people = [viewerId, ...(ret ? [ret.ownerUserId, ret.finderUserId] : [])];
  const users = await db.user.findMany({ where: { id: { in: people } }, select: { id: true, nickname: true, isSuspended: true, suspendedUntil: true, withdrawnAt: true } });
  const unavailable = new Set(users.filter((u) => u.withdrawnAt !== null || isCurrentlySuspended(u)).map((u) => u.id));
  const alreadySent = (await db.thankNote.count({ where: { postType, postId, senderUserId: viewerId } })) > 0;
  const target = thankTarget(viewerId, {
    completed,
    ret: ret && { id: ret.id, chatRoomId: ret.chatRoomId, ownerUserId: ret.ownerUserId, finderUserId: ret.finderUserId, revoked: ret.revokedAt !== null },
    writers,
    unavailable,
    alreadySent,
  });
  // "already sent" is only worth saying to the owner of the active return
  const ownerOfReturn = ret?.ownerUserId === viewerId;
  return { target, alreadySent: alreadySent && ownerOfReturn, returnId: ret?.id ?? null, nicknames: new Map(users.map((u) => [u.id, u.nickname])) };
}

export type ThankComposerState = { alreadySent: boolean; returnId: number | null; receiver: { id: number; nickname: string | null } | null };

// What the viewer is offered for a post (null: nothing to show).
export async function thankComposerFor(viewerId: number, postType: PostType, postId: number): Promise<ThankComposerState | null> {
  const ctx = await loadContext(prisma, viewerId, postType, postId);
  if (!ctx) return null;
  if (ctx.alreadySent) return { alreadySent: true, returnId: ctx.returnId, receiver: null };
  if (!ctx.target) return null;
  return { alreadySent: false, returnId: ctx.target.returnId, receiver: { id: ctx.target.receiverId, nickname: ctx.nicknames.get(ctx.target.receiverId) ?? null } };
}

// The same, inside a chat room: only the room the return was recorded in.
export async function thankComposerForRoom(viewerId: number, chatRoomId: number): Promise<(ThankComposerState & { postType: PostType; postId: number }) | null> {
  const state = await chatRoomPostState(prisma, chatRoomId, viewerId);
  if (!state || !state.completed) return null;
  const ret = await prisma.postReturn.findFirst({ where: { postType: state.postType, postId: state.postId, revokedAt: null }, select: { chatRoomId: true } });
  if (!ret || ret.chatRoomId !== chatRoomId) return null;
  const c = await thankComposerFor(viewerId, state.postType, state.postId);
  return c && { ...c, postType: state.postType, postId: state.postId };
}

export type SendThankError = "empty" | "too_long" | "already_sent" | "not_eligible" | "daily_limit";
export type SendThankResult = { ok: true } | { ok: false; error: SendThankError };

export async function sendThankNote(viewerId: number, input: { postType: PostType; postId: number; body: unknown }): Promise<SendThankResult> {
  const body = validateThankBody(input.body);
  if (!body.ok) return body;
  try {
    return await prisma.$transaction(async (tx) => {
      const ctx = await loadContext(tx, viewerId, input.postType, input.postId);
      if (ctx?.alreadySent) return { ok: false, error: "already_sent" } as const;
      if (!ctx?.target) return { ok: false, error: "not_eligible" } as const;
      const today = await tx.thankNote.count({ where: { senderUserId: viewerId, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
      if (today >= THANK_NOTES_PER_DAY) return { ok: false, error: "daily_limit" } as const;
      const note = await tx.thankNote.create({
        data: { postType: input.postType, postId: input.postId, chatRoomId: ctx.target.chatRoomId, returnId: ctx.target.returnId, senderUserId: viewerId, receiverUserId: ctx.target.receiverId, body: body.body },
      });
      // 수신 알림 (in-app; the unique notification key makes it once per note)
      await notifyUser(tx, {
        data: { userId: ctx.target.receiverId, type: NotificationType.THANK_NOTE, title: "새로운 감사 후기가 도착했어요.", content: "물건을 돌려받은 분이 감사 후기를 보냈어요.", relatedType: "thank_note", relatedId: note.id },
      });
      return { ok: true } as const;
    });
  } catch (error) {
    // the unique (post, sender) index: a second tap or a parallel request
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, error: "already_sent" };
    throw error;
  }
}

export type ReceivedThankNote = { id: number; body: string; createdAt: Date; published: boolean; personal: boolean; postType: PostType; postId: number; postTitle: string | null; senderNickname: string | null };

export async function listReceivedThankNotes(userId: number): Promise<ReceivedThankNote[]> {
  const rows = await prisma.thankNote.findMany({
    where: { receiverUserId: userId, hiddenAt: null, adminHiddenAt: null },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, body: true, createdAt: true, publishedAt: true, postType: true, postId: true, sender: { select: { nickname: true } }, chatRoom: { select: { postTitle: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt,
    published: r.publishedAt !== null,
    personal: looksPersonal(r.body),
    postType: r.postType as PostType,
    postId: r.postId,
    postTitle: r.chatRoom?.postTitle ?? null,
    senderNickname: r.sender.nickname,
  }));
}

// Phase 3-B: the 감사 후기 written in one chat room, as each participant
// sees them -- the viewer's own sent note, and a note the viewer received
// (not hidden by them). Never another room's, never someone else's; an
// admin-hidden note is shown nowhere. The sender is not told whether the
// receiver published it.
export type RoomThankNote = { id: number; role: "sent" | "received"; body: string; createdAt: Date; published: boolean; personal: boolean };
export async function thankNotesForRoom(viewerId: number, chatRoomId: number): Promise<RoomThankNote[]> {
  const rows = await prisma.thankNote.findMany({
    where: {
      chatRoomId,
      adminHiddenAt: null,
      OR: [{ senderUserId: viewerId }, { receiverUserId: viewerId, hiddenAt: null }],
    },
    orderBy: { createdAt: "asc" },
    take: 10,
    select: { id: true, body: true, createdAt: true, publishedAt: true, senderUserId: true },
  });
  return rows.map((r) => {
    const sent = r.senderUserId === viewerId;
    return { id: r.id, role: sent ? "sent" : "received", body: r.body, createdAt: r.createdAt, published: !sent && r.publishedAt !== null, personal: !sent && looksPersonal(r.body) };
  });
}

// Only the receiver can publish, unpublish or hide, and only its own notes.
// A note that looks like it holds contact / ID details is never published.
export type PublishResult = { ok: true } | { ok: false; reason: "not_found" | "personal" };
export async function setThankNotePublished(userId: number, noteId: number, published: boolean): Promise<PublishResult> {
  const mine = { id: noteId, receiverUserId: userId, hiddenAt: null, adminHiddenAt: null };
  if (published) {
    const note = await prisma.thankNote.findFirst({ where: mine, select: { body: true } });
    if (!note) return { ok: false, reason: "not_found" };
    if (looksPersonal(note.body)) return { ok: false, reason: "personal" };
  }
  const r = await prisma.thankNote.updateMany({ where: mine, data: { publishedAt: published ? new Date() : null } });
  return r.count === 1 ? { ok: true } : { ok: false, reason: "not_found" };
}
export async function hideThankNote(userId: number, noteId: number): Promise<boolean> {
  const r = await prisma.thankNote.updateMany({ where: { id: noteId, receiverUserId: userId, hiddenAt: null }, data: { hiddenAt: new Date(), publishedAt: null } });
  return r.count === 1;
}

// A profile's published notes: body and day only, never the sender. A note
// with a pending report is held back until an admin has looked at it.
export async function listPublicThankNotes(receiverId: number, take = 10): Promise<{ id: number; body: string; publishedAt: Date }[]> {
  const rows = await prisma.thankNote.findMany({
    where: { receiverUserId: receiverId, hiddenAt: null, adminHiddenAt: null, publishedAt: { not: null } },
    orderBy: { publishedAt: "desc" },
    take: take + 10,
    select: { id: true, body: true, publishedAt: true },
  });
  if (!rows.length) return [];
  const reported = new Set(
    (await prisma.report.findMany({ where: { targetType: ReportTargetType.THANK_NOTE, targetId: { in: rows.map((r) => r.id) }, status: ReportStatus.PENDING }, select: { targetId: true } })).map((r) => r.targetId),
  );
  return rows.filter((r) => !reported.has(r.id)).slice(0, take).map((r) => ({ id: r.id, body: r.body, publishedAt: r.publishedAt! }));
}
