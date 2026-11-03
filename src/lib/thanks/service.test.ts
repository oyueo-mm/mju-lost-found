import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const db = {
  lostPost: { findUnique: vi.fn() },
  foundPost: { findUnique: vi.fn() },
  chatRoom: { findMany: vi.fn() },
  message: { groupBy: vi.fn() },
  user: { findMany: vi.fn() },
  thankNote: { count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
const { sendThankNote, setThankNotePublished, hideThankNote, listPublicThankNotes } = await import("./service");

const user = (id: number) => ({ id, nickname: `u${id}`, isSuspended: false, suspendedUntil: null, withdrawnAt: null });
beforeEach(() => {
  vi.clearAllMocks();
  // lost post 5 by user 10, marked 찾음; user 20 chatted with them, both wrote
  db.lostPost.findUnique.mockResolvedValue({ userId: 10, status: "FOUND", title: "지갑" });
  db.chatRoom.findMany.mockResolvedValue([{ id: 1, initiatorUserId: 20, counterpartUserId: 10, organizationId: null }]);
  db.message.groupBy.mockResolvedValue([{ chatRoomId: 1, senderUserId: 10 }, { chatRoomId: 1, senderUserId: 20 }]);
  db.user.findMany.mockResolvedValue([user(10), user(20)]);
  db.thankNote.count.mockResolvedValue(0);
  db.thankNote.create.mockResolvedValue({});
});

describe("sendThankNote", () => {
  it("creates the note for an eligible pair, tied to the chat room", async () => {
    expect(await sendThankNote(10, { postType: "lost", postId: 5, receiverId: 20, body: " 감사합니다 " })).toEqual({ ok: true });
    expect(db.thankNote.create).toHaveBeenCalledWith({ data: { postType: "lost", postId: 5, chatRoomId: 1, senderUserId: 10, receiverUserId: 20, body: "감사합니다" } });
  });

  it("re-derives eligibility on the server: any other receiver or sender is refused", async () => {
    expect((await sendThankNote(10, { postType: "lost", postId: 5, receiverId: 99, body: "x" })).ok).toBe(false);
    expect((await sendThankNote(20, { postType: "lost", postId: 5, receiverId: 10, body: "x" })).ok).toBe(false);
    db.lostPost.findUnique.mockResolvedValue({ userId: 10, status: "SEARCHING", title: "지갑" });
    expect((await sendThankNote(10, { postType: "lost", postId: 5, receiverId: 20, body: "x" })).ok).toBe(false);
    expect(db.thankNote.create).not.toHaveBeenCalled();
  });

  it("refuses a second note and the sixth note of a day", async () => {
    db.thankNote.count.mockResolvedValueOnce(1); // already sent for this post
    expect(await sendThankNote(10, { postType: "lost", postId: 5, receiverId: 20, body: "x" })).toEqual({ ok: false, error: "이 게시글에는 이미 감사 쪽지를 보냈어요." });
    db.thankNote.count.mockResolvedValueOnce(0).mockResolvedValueOnce(5); // this post: none; last 24h: 5
    expect((await sendThankNote(10, { postType: "lost", postId: 5, receiverId: 20, body: "x" })).ok).toBe(false);
    expect(db.thankNote.create).not.toHaveBeenCalled();
  });

  it("a parallel double submit hits the unique index and reads as already sent", async () => {
    db.thankNote.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    expect(await sendThankNote(10, { postType: "lost", postId: 5, receiverId: 20, body: "x" })).toEqual({ ok: false, error: "이 게시글에는 이미 감사 쪽지를 보냈어요." });
  });

  it("an empty note never reaches the database", async () => {
    expect((await sendThankNote(10, { postType: "lost", postId: 5, receiverId: 20, body: "  " })).ok).toBe(false);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("publishing", () => {
  it("only the receiver's own, not hidden note can be published / hidden", async () => {
    db.thankNote.updateMany.mockResolvedValue({ count: 1 });
    expect(await setThankNotePublished(20, 3, true)).toBe(true);
    expect(db.thankNote.updateMany.mock.calls[0][0].where).toEqual({ id: 3, receiverUserId: 20, hiddenAt: null });
    expect(db.thankNote.updateMany.mock.calls[0][0].data.publishedAt).toBeInstanceOf(Date);
    await hideThankNote(20, 3);
    expect(db.thankNote.updateMany.mock.calls[1][0].data).toMatchObject({ publishedAt: null });
    db.thankNote.updateMany.mockResolvedValue({ count: 0 });
    expect(await setThankNotePublished(99, 3, true)).toBe(false);
  });

  it("a profile lists published, not hidden notes, without any sender field", async () => {
    db.thankNote.findMany.mockResolvedValue([{ id: 3, body: "고마워요", publishedAt: new Date("2026-11-03T00:00:00Z") }]);
    const notes = await listPublicThankNotes(20);
    expect(db.thankNote.findMany.mock.calls[0][0].where).toEqual({ receiverUserId: 20, hiddenAt: null, publishedAt: { not: null } });
    expect(Object.keys(db.thankNote.findMany.mock.calls[0][0].select)).toEqual(["id", "body", "publishedAt"]);
    expect(notes[0]).toEqual({ id: 3, body: "고마워요", publishedAt: new Date("2026-11-03T00:00:00Z") });
  });
});
