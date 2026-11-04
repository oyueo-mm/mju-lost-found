import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const db = {
  lostPost: { findUnique: vi.fn() },
  foundPost: { findUnique: vi.fn() },
  postReturn: { findFirst: vi.fn() },
  message: { groupBy: vi.fn() },
  user: { findMany: vi.fn(), count: vi.fn() },
  notification: { create: vi.fn() },
  report: { findMany: vi.fn() },
  thankNote: { count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/posts/returns", () => ({ chatRoomPostState: vi.fn() }));
const { sendThankNote, setThankNotePublished, hideThankNote, listPublicThankNotes, thankComposerFor } = await import("./service");

const user = (id: number) => ({ id, nickname: `u${id}`, isSuspended: false, suspendedUntil: null, withdrawnAt: null });
beforeEach(() => {
  vi.clearAllMocks();
  // lost post 5 by user 10 marked 찾음 from room 1, where 20 returned it; both wrote
  db.lostPost.findUnique.mockResolvedValue({ status: "FOUND" });
  db.postReturn.findFirst.mockResolvedValue({ id: 9, chatRoomId: 1, ownerUserId: 10, finderUserId: 20, revokedAt: null });
  db.message.groupBy.mockResolvedValue([{ senderUserId: 10 }, { senderUserId: 20 }]);
  db.user.findMany.mockResolvedValue([user(10), user(20)]);
  db.user.count.mockResolvedValue(1);
  db.thankNote.count.mockResolvedValue(0);
  db.thankNote.create.mockResolvedValue({ id: 77 });
  db.report.findMany.mockResolvedValue([]);
});

describe("sendThankNote", () => {
  it("creates the note for the return's owner -> finder, linked to the return, and notifies the receiver in-app", async () => {
    expect(await sendThankNote(10, { postType: "lost", postId: 5, body: " 감사합니다 " })).toEqual({ ok: true });
    expect(db.thankNote.create).toHaveBeenCalledWith({ data: { postType: "lost", postId: 5, chatRoomId: 1, returnId: 9, senderUserId: 10, receiverUserId: 20, body: "감사합니다", tags: [] } });
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({ userId: 20, type: "THANK_NOTE", relatedType: "thank_note", relatedId: 77 });
  });

  it("the receiver comes from the return, never from the request; others are refused", async () => {
    expect(await sendThankNote(20, { postType: "lost", postId: 5, body: "x" })).toEqual({ ok: false, error: "not_eligible" });
    expect(await sendThankNote(30, { postType: "lost", postId: 5, body: "x" })).toEqual({ ok: false, error: "not_eligible" });
    db.postReturn.findFirst.mockResolvedValue(null); // completed from the post page
    expect(await sendThankNote(10, { postType: "lost", postId: 5, body: "x" })).toEqual({ ok: false, error: "not_eligible" });
    expect(db.thankNote.create).not.toHaveBeenCalled();
  });

  it("refuses a second note and the sixth note of a day", async () => {
    db.thankNote.count.mockResolvedValueOnce(1);
    expect(await sendThankNote(10, { postType: "lost", postId: 5, body: "x" })).toEqual({ ok: false, error: "already_sent" });
    db.thankNote.count.mockResolvedValueOnce(0).mockResolvedValueOnce(5);
    expect(await sendThankNote(10, { postType: "lost", postId: 5, body: "x" })).toEqual({ ok: false, error: "daily_limit" });
    expect(db.thankNote.create).not.toHaveBeenCalled();
  });

  it("a parallel double submit hits the unique index and reads as already sent", async () => {
    db.thankNote.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    expect(await sendThankNote(10, { postType: "lost", postId: 5, body: "x" })).toEqual({ ok: false, error: "already_sent" });
  });

  it("an empty note never reaches the database", async () => {
    expect(await sendThankNote(10, { postType: "lost", postId: 5, body: "  " })).toEqual({ ok: false, error: "empty" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("thankComposerFor", () => {
  it("offers the composer with the recorded partner; says 'sent' only to the return's owner", async () => {
    expect(await thankComposerFor(10, "lost", 5)).toEqual({ alreadySent: false, returnId: 9, receiver: { id: 20, nickname: "u20" } });
    expect(await thankComposerFor(20, "lost", 5)).toBeNull();
    db.thankNote.count.mockResolvedValue(1);
    expect(await thankComposerFor(10, "lost", 5)).toEqual({ alreadySent: true, returnId: 9, receiver: null });
  });
});

describe("publishing", () => {
  it("only the receiver's own, visible note can be published / hidden", async () => {
    db.thankNote.findFirst.mockResolvedValue({ body: "고마워요" });
    db.thankNote.updateMany.mockResolvedValue({ count: 1 });
    expect(await setThankNotePublished(20, 3, true)).toEqual({ ok: true });
    expect(db.thankNote.findFirst.mock.calls[0][0].where).toEqual({ id: 3, receiverUserId: 20, hiddenAt: null, adminHiddenAt: null });
    expect(db.thankNote.updateMany.mock.calls[0][0].data.publishedAt).toBeInstanceOf(Date);
    await hideThankNote(20, 3);
    expect(db.thankNote.updateMany.mock.calls[1][0].data).toMatchObject({ publishedAt: null });
    db.thankNote.findFirst.mockResolvedValue(null);
    expect(await setThankNotePublished(99, 3, true)).toEqual({ ok: false, reason: "not_found" });
  });

  it("a note that looks like it holds contact details is never published", async () => {
    db.thankNote.findFirst.mockResolvedValue({ body: "감사해요! 010-1234-5678로 연락주세요" });
    expect(await setThankNotePublished(20, 3, true)).toEqual({ ok: false, reason: "personal" });
    expect(db.thankNote.updateMany).not.toHaveBeenCalled();
  });

  it("a profile lists published, visible notes without the sender, holding back reported ones", async () => {
    db.thankNote.findMany.mockResolvedValue([
      { id: 3, body: "고마워요", publishedAt: new Date("2026-11-03T00:00:00Z") },
      { id: 4, body: "신고된 쪽지", publishedAt: new Date("2026-11-02T00:00:00Z") },
    ]);
    db.report.findMany.mockResolvedValue([{ targetId: 4 }]);
    const notes = await listPublicThankNotes(20);
    expect(db.thankNote.findMany.mock.calls[0][0].where).toEqual({ receiverUserId: 20, hiddenAt: null, adminHiddenAt: null, publishedAt: { not: null } });
    expect(Object.keys(db.thankNote.findMany.mock.calls[0][0].select)).toEqual(["id", "body", "tags", "publishedAt"]);
    expect(notes).toEqual([{ id: 3, body: "고마워요", publishedAt: new Date("2026-11-03T00:00:00Z") }]);
  });
});

// Phase 3-B: the 감사 후기 shown inside a chat room.
describe("thankNotesForRoom", () => {
  it("asks only for this room's notes the viewer sent, or received and kept -- never admin-hidden ones", async () => {
    db.thankNote.findMany.mockResolvedValue([]);
    const { thankNotesForRoom } = await import("./service");
    await thankNotesForRoom(10, 1);
    expect(db.thankNote.findMany.mock.calls[0][0].where).toEqual({
      chatRoomId: 1,
      adminHiddenAt: null,
      OR: [{ senderUserId: 10 }, { receiverUserId: 10, hiddenAt: null }],
    });
  });

  it("marks sent / received; the sender is never told whether the receiver published it", async () => {
    const at = new Date("2026-11-04T00:00:00Z");
    db.thankNote.findMany.mockResolvedValue([{ id: 1, body: "감사합니다", createdAt: at, publishedAt: at, senderUserId: 10 }]);
    const { thankNotesForRoom } = await import("./service");
    expect(await thankNotesForRoom(10, 1)).toEqual([{ id: 1, role: "sent", body: "감사합니다", createdAt: at, published: false, personal: false }]);
    expect(await thankNotesForRoom(20, 1)).toEqual([{ id: 1, role: "received", body: "감사합니다", createdAt: at, published: true, personal: false }]);
  });

  it("flags a received note that looks like it holds contact details (it cannot be published)", async () => {
    db.thankNote.findMany.mockResolvedValue([{ id: 2, body: "연락 주세요 010-1234-5678", createdAt: new Date(), publishedAt: null, senderUserId: 10 }]);
    const { thankNotesForRoom } = await import("./service");
    expect((await thankNotesForRoom(20, 1))[0]).toMatchObject({ role: "received", published: false, personal: true });
  });
});

// Several rooms on one post: only the room the return was recorded in may
// offer the 감사 후기, and only to that return's owner.
describe("thankComposerForRoom (several rooms on one post)", () => {
  it("offers the review in the return's room and nowhere else", async () => {
    const returns = await import("@/lib/posts/returns");
    const state = (partnerId: number) => ({ postType: "lost" as const, postId: 5, authorId: 10, completed: true, partnerId });
    const { thankComposerForRoom } = await import("./service");
    vi.mocked(returns.chatRoomPostState).mockResolvedValue(state(20));
    // the return (room 1, finder 20) -- viewed from room 1
    expect(await thankComposerForRoom(10, 1)).toMatchObject({ postType: "lost", postId: 5, receiver: { id: 20 } });
    // the same owner in another room of the same post (room 2, with user 30)
    vi.mocked(returns.chatRoomPostState).mockResolvedValue(state(30));
    expect(await thankComposerForRoom(10, 2)).toBeNull();
    // the finder may not thank in either room
    vi.mocked(returns.chatRoomPostState).mockResolvedValue(state(10));
    expect(await thankComposerForRoom(20, 1)).toBeNull();
  });
});

// Phase 3-B 칭찬 태그 (needs the tags migration).
describe("sendThankNote with 칭찬 태그", () => {
  it("sends tags only, a message only, or both -- never neither", async () => {
    expect(await sendThankNote(10, { postType: "lost", postId: 5, body: "", tags: ["kind", "quick_reply"] })).toEqual({ ok: true });
    expect(db.thankNote.create.mock.calls[0][0].data).toMatchObject({ body: "", tags: ["kind", "quick_reply"] });
    expect(await sendThankNote(10, { postType: "lost", postId: 5, body: "   ", tags: [] })).toEqual({ ok: false, error: "empty" });
    expect(db.thankNote.create).toHaveBeenCalledTimes(1);
  });

  it("keeps all five tags, drops unknown or repeated ones, in the fixed order", async () => {
    await sendThankNote(10, { postType: "lost", postId: 5, body: "", tags: ["kept_promise", "kind", "정말 감사해요", "kind", "helpful", "kept_well", "quick_reply"] });
    expect(db.thankNote.create.mock.calls[0][0].data.tags).toEqual(["kind", "quick_reply", "kept_well", "helpful", "kept_promise"]);
  });

  it("the tags never change who may thank whom", async () => {
    expect(await sendThankNote(20, { postType: "lost", postId: 5, body: "", tags: ["kind"] })).toEqual({ ok: false, error: "not_eligible" });
    expect(db.thankNote.create).not.toHaveBeenCalled();
  });
});
