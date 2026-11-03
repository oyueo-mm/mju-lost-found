import { prisma } from "@/lib/db/prisma";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { Prisma } from "@/generated/prisma/client";
import { looksPersonal, THANK_NOTES_PER_DAY, thankCandidates, validateThankBody, type ThankRoom } from "./eligibility";

// 감사 쪽지 storage and permissions. Every write re-derives who may thank
// whom from the database (eligibility.ts); nothing the client sends is
// trusted beyond the post and the chosen receiver. Notes are private to
// their receiver until the receiver publishes them; a published note is
// shown without its sender.

type PostType = "lost" | "found";
type Db = Prisma.TransactionClient | typeof prisma;

async function loadContext(db: Db, viewerId: number, postType: PostType, postId: number) {
  const post =
    postType === "lost"
      ? await db.lostPost.findUnique({ where: { id: postId }, select: { userId: true, status: true, title: true } })
      : await db.foundPost.findUnique({ where: { id: postId }, select: { userId: true, status: true, title: true } });
  if (!post) return null;
  const completed = postType === "lost" ? post.status === "FOUND" : post.status === "COMPLETED";
  const rooms = await db.chatRoom.findMany({
    where: postType === "lost" ? { directLostPostId: postId } : { directFoundPostId: postId },
    select: { id: true, initiatorUserId: true, counterpartUserId: true, organizationId: true },
  });
  const writers = rooms.length
    ? await db.message.groupBy({ by: ["chatRoomId", "senderUserId"], where: { chatRoomId: { in: rooms.map((r) => r.id) } } })
    : [];
  const thankRooms: ThankRoom[] = rooms.map((r) => ({ ...r, writers: writers.filter((w) => w.chatRoomId === r.id).map((w) => w.senderUserId) }));
  const people = [...new Set([viewerId, ...rooms.flatMap((r) => [r.initiatorUserId, r.counterpartUserId]).filter((id): id is number => id !== null)])];
  const users = await db.user.findMany({ where: { id: { in: people } }, select: { id: true, nickname: true, isSuspended: true, suspendedUntil: true, withdrawnAt: true } });
  const unavailable = new Set(users.filter((u) => u.withdrawnAt !== null || isCurrentlySuspended(u)).map((u) => u.id));
  const alreadySent = (await db.thankNote.count({ where: { postType, postId, senderUserId: viewerId } })) > 0;
  const candidates = thankCandidates({ type: postType, authorId: post.userId, completed }, viewerId, thankRooms, { unavailable, alreadySent });
  return { post, candidates, alreadySent, nicknames: new Map(users.map((u) => [u.id, u.nickname])) };
}

export type ThankComposerState = { alreadySent: boolean; receivers: { id: number; nickname: string | null }[] };

// What the post page offers the viewer (null: nothing to show).
export async function thankComposerFor(viewerId: number, postType: PostType, postId: number): Promise<ThankComposerState | null> {
  const ctx = await loadContext(prisma, viewerId, postType, postId);
  if (!ctx) return null;
  if (ctx.alreadySent) return { alreadySent: true, receivers: [] };
  if (ctx.candidates.length === 0) return null;
  return { alreadySent: false, receivers: ctx.candidates.map((c) => ({ id: c.receiverId, nickname: ctx.nicknames.get(c.receiverId) ?? null })) };
}

export type SendThankResult = { ok: true } | { ok: false; error: string };

export async function sendThankNote(viewerId: number, input: { postType: PostType; postId: number; receiverId: number; body: unknown }): Promise<SendThankResult> {
  const body = validateThankBody(input.body);
  if (!body.ok) return body;
  try {
    return await prisma.$transaction(async (tx) => {
      const ctx = await loadContext(tx, viewerId, input.postType, input.postId);
      if (ctx?.alreadySent) return { ok: false, error: "이 게시글에는 이미 감사 쪽지를 보냈어요." };
      const candidate = ctx?.candidates.find((c) => c.receiverId === input.receiverId);
      if (!candidate) return { ok: false, error: "이 게시글로 연결된 상대에게만 감사 쪽지를 보낼 수 있어요." };
      const today = await tx.thankNote.count({ where: { senderUserId: viewerId, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
      if (today >= THANK_NOTES_PER_DAY) return { ok: false, error: "감사 쪽지는 하루에 최대 5개까지 보낼 수 있어요." };
      await tx.thankNote.create({
        data: { postType: input.postType, postId: input.postId, chatRoomId: candidate.chatRoomId, senderUserId: viewerId, receiverUserId: candidate.receiverId, body: body.body },
      });
      return { ok: true } as const;
    });
  } catch (error) {
    // the unique (post, sender) index: a second tap or a parallel request
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, error: "이 게시글에는 이미 감사 쪽지를 보냈어요." };
    throw error;
  }
}

export type ReceivedThankNote = { id: number; body: string; createdAt: Date; published: boolean; personal: boolean; postType: PostType; postId: number; postTitle: string | null; senderNickname: string | null };

export async function listReceivedThankNotes(userId: number): Promise<ReceivedThankNote[]> {
  const rows = await prisma.thankNote.findMany({
    where: { receiverUserId: userId, hiddenAt: null },
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

// Only the receiver can publish, unpublish or hide, and only its own notes.
// A note that looks like it holds contact / ID details is never published.
export type PublishResult = { ok: true } | { ok: false; reason: "not_found" | "personal" };
export async function setThankNotePublished(userId: number, noteId: number, published: boolean): Promise<PublishResult> {
  if (published) {
    const note = await prisma.thankNote.findFirst({ where: { id: noteId, receiverUserId: userId, hiddenAt: null }, select: { body: true } });
    if (!note) return { ok: false, reason: "not_found" };
    if (looksPersonal(note.body)) return { ok: false, reason: "personal" };
  }
  const r = await prisma.thankNote.updateMany({ where: { id: noteId, receiverUserId: userId, hiddenAt: null }, data: { publishedAt: published ? new Date() : null } });
  return r.count === 1 ? { ok: true } : { ok: false, reason: "not_found" };
}
export async function hideThankNote(userId: number, noteId: number): Promise<boolean> {
  const r = await prisma.thankNote.updateMany({ where: { id: noteId, receiverUserId: userId, hiddenAt: null }, data: { hiddenAt: new Date(), publishedAt: null } });
  return r.count === 1;
}

// A profile's published notes: body and day only, never the sender.
export async function listPublicThankNotes(receiverId: number, take = 10): Promise<{ id: number; body: string; publishedAt: Date }[]> {
  const rows = await prisma.thankNote.findMany({
    where: { receiverUserId: receiverId, hiddenAt: null, publishedAt: { not: null } },
    orderBy: { publishedAt: "desc" },
    take,
    select: { id: true, body: true, publishedAt: true },
  });
  return rows.map((r) => ({ id: r.id, body: r.body, publishedAt: r.publishedAt! }));
}
