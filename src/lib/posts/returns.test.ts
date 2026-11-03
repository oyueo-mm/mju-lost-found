import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const db = {
  chatRoom: { findUnique: vi.fn(), findMany: vi.fn() },
  lostPost: { findUnique: vi.fn(), update: vi.fn() },
  foundPost: { findUnique: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  postStatusChange: { create: vi.fn() },
  postReturn: { create: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/chat/realtimeAdmin", () => ({ broadcastChatEvent: vi.fn() }));
const { canCompleteFromChat, completeFromChat, returnRoles } = await import("./returns");

const author = { id: 10, isSuspended: false, suspendedUntil: null };
beforeEach(() => {
  vi.clearAllMocks();
  // room 2 of lost post 5 (author 10), opened by 20
  db.chatRoom.findUnique.mockResolvedValue({ organizationId: null, initiatorUserId: 20, counterpartUserId: 10, directLostPostId: 5, directFoundPostId: null });
  db.lostPost.findUnique.mockResolvedValue({ userId: 10, status: "SEARCHING" });
  db.$queryRaw.mockResolvedValue([{ status: "찾는 중" }]);
  db.user.findUnique.mockResolvedValue({ withdrawnAt: null });
  db.postReturn.create.mockResolvedValue({ id: 31 });
});

describe("반환 역할", () => {
  it("lost: author = owner, partner = finder; found: author = finder, partner = owner", () => {
    expect(returnRoles("lost", 10, 20)).toEqual({ ownerUserId: 10, finderUserId: 20 });
    expect(returnRoles("found", 10, 20)).toEqual({ ownerUserId: 20, finderUserId: 10 });
  });
  it("only the author of an open post sees 찾음 완료", () => {
    const s = { postType: "lost" as const, postId: 5, authorId: 10, completed: false, partnerId: 20 };
    expect(canCompleteFromChat(s, 10)).toBe(true);
    expect(canCompleteFromChat({ ...s, partnerId: 10 }, 20)).toBe(false);
    expect(canCompleteFromChat({ ...s, completed: true }, 10)).toBe(false);
    expect(canCompleteFromChat(null, 10)).toBe(false);
  });
});

describe("completeFromChat", () => {
  it("marks the post done, records history and links THIS room's other person as the return partner", async () => {
    expect(await completeFromChat(author, 2)).toMatchObject({ kind: "ok", postType: "lost", postId: 5, returnId: 31, ownerUserId: 10, finderUserId: 20 });
    expect(db.lostPost.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { status: "FOUND" } });
    expect(db.postStatusChange.create.mock.calls[0][0].data).toMatchObject({ postType: "lost", postId: 5, fromStatus: "찾는 중", toStatus: "찾음", changedByUserId: 10, action: "owner_status", reason: "chat" });
    expect(db.postReturn.create.mock.calls[0][0].data).toEqual({ postType: "lost", postId: 5, chatRoomId: 2, completedByUserId: 10, ownerUserId: 10, finderUserId: 20 });
    // the post row is locked before the status is re-read
    expect(String(db.$queryRaw.mock.calls[0][0].join("?"))).toContain("FOR UPDATE");
  });

  it("a found post: the finder (author) completes, the owner (partner) is recorded as owner", async () => {
    db.chatRoom.findUnique.mockResolvedValue({ organizationId: null, initiatorUserId: 20, counterpartUserId: 10, directLostPostId: null, directFoundPostId: 8 });
    db.foundPost.findUnique.mockResolvedValue({ userId: 10, status: "KEEPING" });
    db.$queryRaw.mockResolvedValue([{ status: "보관 중" }]);
    expect(await completeFromChat(author, 2)).toMatchObject({ kind: "ok", postType: "found", ownerUserId: 20, finderUserId: 10 });
    expect(db.foundPost.update).toHaveBeenCalledWith({ where: { id: 8 }, data: { status: "COMPLETED" } });
  });

  it("refuses anyone but the author, outsiders, organization rooms and suspended users", async () => {
    expect(await completeFromChat({ id: 20, isSuspended: false, suspendedUntil: null }, 2)).toEqual({ kind: "forbidden", reason: "not_author" });
    expect(await completeFromChat({ id: 99, isSuspended: false, suspendedUntil: null }, 2)).toEqual({ kind: "not_found" });
    expect(await completeFromChat({ ...author, isSuspended: true }, 2)).toEqual({ kind: "forbidden", reason: "suspended" });
    db.chatRoom.findUnique.mockResolvedValue({ organizationId: 4, initiatorUserId: 20, counterpartUserId: null, directLostPostId: 5, directFoundPostId: null });
    expect(await completeFromChat(author, 2)).toEqual({ kind: "not_found" });
    expect(db.postReturn.create).not.toHaveBeenCalled();
  });

  it("an already-done post (re-read under the lock) and a withdrawn partner are refused", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ status: "찾음" }]);
    expect(await completeFromChat(author, 2)).toEqual({ kind: "already_completed" });
    db.user.findUnique.mockResolvedValueOnce({ withdrawnAt: new Date() });
    expect(await completeFromChat(author, 2)).toEqual({ kind: "forbidden", reason: "partner_unavailable" });
    expect(db.postReturn.create).not.toHaveBeenCalled();
  });

  it("losing the race on the one-active-return index reads as already completed", async () => {
    db.postReturn.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    expect(await completeFromChat(author, 2)).toEqual({ kind: "already_completed" });
  });
});
