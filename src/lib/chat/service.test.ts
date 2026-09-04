import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/generated/prisma/client";

class FakePrismaClientKnownRequestError extends Error {
  code: string;
  constructor(code: string) {
    super("mock prisma error");
    this.code = code;
  }
}

const match = { findUnique: vi.fn() };
const chatRoom = { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() };
const message = { findMany: vi.fn(), updateMany: vi.fn() };
const userTable = { findUnique: vi.fn() };
const notification = { updateMany: vi.fn() };
const txMessageCreate = vi.fn();
const txNotificationCreate = vi.fn();
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({ message: { create: txMessageCreate }, notification: { create: txNotificationCreate } }),
);

vi.mock("@/lib/db/prisma", () => ({
  prisma: { match, chatRoom, message, user: userTable, notification, $transaction },
}));
vi.mock("@/generated/prisma/client", () => ({
  NotificationType: { MESSAGE: "MESSAGE" },
  Prisma: { PrismaClientKnownRequestError: FakePrismaClientKnownRequestError },
}));

const {
  getChatRoomForUser,
  getOrCreateChatRoomForMatch,
  listChatRoomsForUser,
  listMessages,
  markMessageNotificationsReadForChatRoom,
  markMessagesAsRead,
  sendMessage,
} = await import("./service");

const lostOwner = 1;
const foundOwner = 2;
const stranger = 999;

function postRef(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, userId: lostOwner, title: "지갑 분실", ...overrides };
}

function roomWithMatch(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 100,
    matchId: 10,
    createdAt: new Date("2026-01-01"),
    match: {
      id: 10,
      lostPost: postRef({ id: 1, userId: lostOwner, title: "지갑 분실" }),
      foundPost: postRef({ id: 2, userId: foundOwner, title: "지갑 습득" }),
    },
    ...overrides,
  };
}

const sender = { id: lostOwner, nickname: "닉네임", isSuspended: false, suspendedUntil: null } as unknown as User;

beforeEach(() => {
  vi.clearAllMocks();
  userTable.findUnique.mockResolvedValue({ id: foundOwner, nickname: "상대닉네임" });
});

describe("getOrCreateChatRoomForMatch", () => {
  it("returns match_not_found for a nonexistent match", async () => {
    match.findUnique.mockResolvedValueOnce(null);

    const result = await getOrCreateChatRoomForMatch(999, lostOwner);

    expect(result).toEqual({ kind: "match_not_found" });
    expect(chatRoom.create).not.toHaveBeenCalled();
  });

  it("rejects a requester who owns neither side of the match", async () => {
    match.findUnique.mockResolvedValueOnce({
      id: 10,
      lostPost: postRef({ userId: lostOwner }),
      foundPost: postRef({ userId: foundOwner }),
    });

    const result = await getOrCreateChatRoomForMatch(10, stranger);

    expect(result).toEqual({ kind: "forbidden" });
    expect(chatRoom.create).not.toHaveBeenCalled();
  });

  it("returns the existing room instead of creating a duplicate (idempotent)", async () => {
    match.findUnique.mockResolvedValueOnce({
      id: 10,
      lostPost: postRef({ userId: lostOwner }),
      foundPost: postRef({ userId: foundOwner }),
    });
    chatRoom.findUnique.mockResolvedValueOnce({ id: 100 }); // existing room found by matchId
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch()); // findChatRoomWithMatch(100)

    const result = await getOrCreateChatRoomForMatch(10, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.id).toBe(100);
    expect(chatRoom.create).not.toHaveBeenCalled();
  });

  it("creates a new room when none exists yet", async () => {
    match.findUnique.mockResolvedValueOnce({
      id: 10,
      lostPost: postRef({ userId: lostOwner }),
      foundPost: postRef({ userId: foundOwner }),
    });
    chatRoom.findUnique.mockResolvedValueOnce(null); // no existing room
    chatRoom.create.mockResolvedValueOnce({ id: 100 });
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch()); // findChatRoomWithMatch(100)

    const result = await getOrCreateChatRoomForMatch(10, foundOwner);

    expect(result.kind).toBe("ok");
    expect(chatRoom.create).toHaveBeenCalledWith({ data: { matchId: 10 }, select: { id: true } });
  });

  it("resolves a concurrent duplicate-creation race by returning the winning room", async () => {
    match.findUnique.mockResolvedValueOnce({
      id: 10,
      lostPost: postRef({ userId: lostOwner }),
      foundPost: postRef({ userId: foundOwner }),
    });
    chatRoom.findUnique.mockResolvedValueOnce(null); // no existing room seen at first
    chatRoom.create.mockRejectedValueOnce(new FakePrismaClientKnownRequestError("P2002"));
    chatRoom.findUnique.mockResolvedValueOnce({ id: 100 }); // the other request's winner
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch()); // findChatRoomWithMatch(100)

    const result = await getOrCreateChatRoomForMatch(10, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.id).toBe(100);
  });
});

describe("getChatRoomForUser", () => {
  it("returns not_found for a nonexistent room", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(null);
    expect(await getChatRoomForUser(999, lostOwner)).toEqual({ kind: "not_found" });
  });

  it("rejects a user who isn't a participant (A's room ID known by B)", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());

    const result = await getChatRoomForUser(100, stranger);

    expect(result).toEqual({ kind: "forbidden" });
  });

  it("returns the room for an actual participant", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());

    const result = await getChatRoomForUser(100, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.counterpart.id).toBe(foundOwner);
  });
});

describe("listChatRoomsForUser", () => {
  it("scopes the query to rooms the user participates in", async () => {
    chatRoom.findMany.mockResolvedValueOnce([]);

    await listChatRoomsForUser(lostOwner);

    expect(chatRoom.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { match: { OR: [{ lostPost: { userId: lostOwner } }, { foundPost: { userId: lostOwner } }] } },
      }),
    );
  });
});

describe("listMessages", () => {
  it("returns not_found for a nonexistent room", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(null);
    expect(await listMessages(999, lostOwner)).toEqual({ kind: "not_found" });
  });

  it("rejects a non-participant (A's room ID known by B)", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());

    const result = await listMessages(100, stranger);

    expect(result).toEqual({ kind: "forbidden" });
    expect(message.findMany).not.toHaveBeenCalled();
  });

  it("returns messages oldest-first even though the DB query orders newest-first", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());
    message.findMany.mockResolvedValueOnce([
      { id: 3, senderUserId: lostOwner, content: "c3", createdAt: new Date(), readAt: null, hiddenAt: null, sender: { nickname: "n" } },
      { id: 2, senderUserId: foundOwner, content: "c2", createdAt: new Date(), readAt: null, hiddenAt: null, sender: { nickname: "n" } },
      { id: 1, senderUserId: lostOwner, content: "c1", createdAt: new Date(), readAt: null, hiddenAt: null, sender: { nickname: "n" } },
    ]);

    const result = await listMessages(100, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.items.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it("marks isMine relative to the requester", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());
    message.findMany.mockResolvedValueOnce([
      { id: 1, senderUserId: lostOwner, content: "c1", createdAt: new Date(), readAt: null, hiddenAt: null, sender: { nickname: "n" } },
    ]);

    const result = await listMessages(100, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.items[0].isMine).toBe(true);
  });

  it("masks hidden message content", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());
    message.findMany.mockResolvedValueOnce([
      { id: 1, senderUserId: foundOwner, content: "real content", createdAt: new Date(), readAt: null, hiddenAt: new Date(), sender: { nickname: "n" } },
    ]);

    const result = await listMessages(100, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.items[0].content).toBe("[관리자에 의해 숨겨진 메시지입니다.]");
  });

  it("reports hasMore via the limit+1 lookahead", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: i + 1,
      senderUserId: lostOwner,
      content: `m${i}`,
      createdAt: new Date(),
      readAt: null,
      hiddenAt: null,
      sender: { nickname: "n" },
    }));
    message.findMany.mockResolvedValueOnce(rows);

    const result = await listMessages(100, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.items).toHaveLength(50);
      expect(result.data.hasMore).toBe(true);
    }
  });

  it("passes the `before` cursor through as an id filter", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());
    message.findMany.mockResolvedValueOnce([]);

    await listMessages(100, lostOwner, 50);

    expect(message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chatRoomId: 100, id: { lt: 50 } } }),
    );
  });
});

describe("markMessagesAsRead", () => {
  it("rejects a non-participant", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());

    const result = await markMessagesAsRead(100, stranger);

    expect(result).toEqual({ kind: "forbidden" });
    expect(message.updateMany).not.toHaveBeenCalled();
  });

  it("only marks the other participant's messages, never the requester's own", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());
    message.updateMany.mockResolvedValueOnce({ count: 2 });

    const result = await markMessagesAsRead(100, lostOwner);

    expect(result).toEqual({ kind: "ok", data: { count: 2 } });
    expect(message.updateMany).toHaveBeenCalledWith({
      where: { chatRoomId: 100, senderUserId: { not: lostOwner }, readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
});

describe("markMessageNotificationsReadForChatRoom", () => {
  it("rejects a non-participant", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());

    const result = await markMessageNotificationsReadForChatRoom(100, stranger);

    expect(result).toEqual({ kind: "forbidden" });
  });

  it("scopes the update to the requester's own message-type notifications for this room's messages", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());
    message.findMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    notification.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await markMessageNotificationsReadForChatRoom(100, lostOwner);

    expect(result).toEqual({ kind: "ok", data: { count: 1 } });
    expect(notification.updateMany).toHaveBeenCalledWith({
      where: {
        userId: lostOwner,
        type: "MESSAGE",
        relatedType: "message",
        relatedId: { in: [1, 2] },
        isRead: false,
      },
      data: { isRead: true },
    });
  });
});

describe("sendMessage", () => {
  it("returns not_found for a nonexistent room", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(null);
    expect(await sendMessage(999, sender, "안녕")).toEqual({ kind: "not_found" });
  });

  it("rejects a non-participant (A's room ID known by B)", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());
    const strangerUser = { ...sender, id: stranger } as unknown as User;

    const result = await sendMessage(100, strangerUser, "안녕");

    expect(result).toEqual({ kind: "forbidden" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("rejects a suspended participant", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());
    const suspended = { ...sender, isSuspended: true } as unknown as User;

    const result = await sendMessage(100, suspended, "안녕");

    expect(result).toEqual({ kind: "forbidden" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("rejects a blank/whitespace-only message", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());

    const result = await sendMessage(100, sender, "   ");

    expect(result).toEqual({ kind: "invalid_content" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("sets the sender to the authenticated user, never a caller-supplied id", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());
    txMessageCreate.mockResolvedValueOnce({
      id: 1,
      senderUserId: lostOwner,
      content: "안녕하세요",
      createdAt: new Date(),
      readAt: null,
      sender: { nickname: "닉네임" },
    });

    const result = await sendMessage(100, sender, "안녕하세요");

    expect(result.kind).toBe("ok");
    expect(txMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ senderUserId: lostOwner }) }),
    );
  });

  it("notifies the other participant, not the sender", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());
    txMessageCreate.mockResolvedValueOnce({
      id: 1,
      senderUserId: lostOwner,
      content: "안녕하세요",
      createdAt: new Date(),
      readAt: null,
      sender: { nickname: "닉네임" },
    });

    await sendMessage(100, sender, "안녕하세요");

    expect(txNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: foundOwner, relatedId: 1 }) }),
    );
  });

  it("sends no notification for a self-match (same user owns both sides)", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(
      roomWithMatch({
        match: {
          id: 10,
          lostPost: postRef({ userId: lostOwner }),
          foundPost: postRef({ userId: lostOwner }),
        },
      }),
    );
    txMessageCreate.mockResolvedValueOnce({
      id: 1,
      senderUserId: lostOwner,
      content: "안녕하세요",
      createdAt: new Date(),
      readAt: null,
      sender: { nickname: "닉네임" },
    });

    await sendMessage(100, sender, "안녕하세요");

    expect(txNotificationCreate).not.toHaveBeenCalled();
  });

  it("propagates a transaction failure instead of reporting a false success", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomWithMatch());
    $transaction.mockRejectedValueOnce(new Error("connection lost"));

    await expect(sendMessage(100, sender, "안녕하세요")).rejects.toThrow("connection lost");
  });
});
