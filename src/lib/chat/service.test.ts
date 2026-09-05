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
const message = { findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() };
const userTable = { findUnique: vi.fn() };
const notification = { updateMany: vi.fn() };
const lostPostTable = { findUnique: vi.fn() };
const foundPostTable = { findUnique: vi.fn() };
const txMessageCreate = vi.fn();
const txNotificationCreate = vi.fn();
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({ message: { create: txMessageCreate }, notification: { create: txNotificationCreate } }),
);

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    match,
    chatRoom,
    message,
    user: userTable,
    notification,
    lostPost: lostPostTable,
    foundPost: foundPostTable,
    $transaction,
  },
}));
vi.mock("@/generated/prisma/client", () => ({
  NotificationType: { MESSAGE: "MESSAGE" },
  Prisma: { PrismaClientKnownRequestError: FakePrismaClientKnownRequestError },
}));
vi.mock("@/lib/auth/suspension", () => ({
  isCurrentlySuspended: (user: { isSuspended?: boolean }) => Boolean(user?.isSuspended),
}));

const {
  getChatRoomForUser,
  getMessage,
  getOrCreateChatRoomForMatch,
  getOrCreateDirectChatRoom,
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
    initiatorUserId: null,
    createdAt: new Date("2026-01-01"),
    match: {
      id: 10,
      lostPost: postRef({ id: 1, userId: lostOwner, title: "지갑 분실" }),
      foundPost: postRef({ id: 2, userId: foundOwner, title: "지갑 습득" }),
    },
    directLostPost: null,
    directFoundPost: null,
    ...overrides,
  };
}

// Phase 10: a direct (non-Match) room -- `stranger` (the viewer) messaged
// LostPost id=1's owner (lostOwner) directly.
function roomDirect(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 200,
    matchId: null,
    initiatorUserId: stranger,
    createdAt: new Date("2026-01-01"),
    match: null,
    directLostPost: postRef({ id: 1, userId: lostOwner, title: "지갑 분실" }),
    directFoundPost: null,
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

// Phase 10: mirrors legacy get_or_create_direct_chat_room()'s exact
// validation order (not suspended -> post exists -> not the post's own
// author), and its idempotent get-or-create shape (backed by ChatRoom's
// real DB unique constraint -- see the Phase 10 report for why no
// migration was needed for this).
describe("getOrCreateDirectChatRoom", () => {
  const viewer = { id: stranger, nickname: "방문자", isSuspended: false, suspendedUntil: null } as unknown as User;

  it("lets a non-owner viewer create a direct room with a LostPost's author", async () => {
    lostPostTable.findUnique.mockResolvedValueOnce({ id: 1, userId: lostOwner });
    chatRoom.findUnique.mockResolvedValueOnce(null); // no existing room
    chatRoom.create.mockResolvedValueOnce({ id: 200 });
    chatRoom.findUnique.mockResolvedValueOnce(roomDirect()); // findChatRoomRow(200)
    userTable.findUnique.mockResolvedValueOnce({ id: lostOwner, nickname: "분실자" });

    const result = await getOrCreateDirectChatRoom("lost", 1, viewer);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.roomType).toBe("direct");
      expect(result.data.id).toBe(200);
    }
    expect(chatRoom.create).toHaveBeenCalledWith({
      data: { directLostPostId: 1, initiatorUserId: stranger },
      select: { id: true },
    });
  });

  it("lets a non-owner viewer create a direct room with a FoundPost's author", async () => {
    foundPostTable.findUnique.mockResolvedValueOnce({ id: 5, userId: foundOwner });
    chatRoom.findUnique.mockResolvedValueOnce(null);
    chatRoom.create.mockResolvedValueOnce({ id: 201 });
    chatRoom.findUnique.mockResolvedValueOnce(
      roomDirect({ id: 201, directLostPost: null, directFoundPost: postRef({ id: 5, userId: foundOwner, title: "지갑 습득" }) }),
    );

    const result = await getOrCreateDirectChatRoom("found", 5, viewer);

    expect(result.kind).toBe("ok");
    expect(chatRoom.create).toHaveBeenCalledWith({
      data: { directFoundPostId: 5, initiatorUserId: stranger },
      select: { id: true },
    });
  });

  it("rejects the post's own author -- no self-chat", async () => {
    const owner = { id: lostOwner, nickname: "분실자", isSuspended: false, suspendedUntil: null } as unknown as User;
    lostPostTable.findUnique.mockResolvedValueOnce({ id: 1, userId: lostOwner });

    const result = await getOrCreateDirectChatRoom("lost", 1, owner);

    expect(result).toEqual({ kind: "forbidden", reason: "self" });
    expect(chatRoom.create).not.toHaveBeenCalled();
  });

  it("rejects a suspended requester before ever looking at the post", async () => {
    const suspended = { id: stranger, nickname: "정지됨", isSuspended: true, suspendedUntil: null } as unknown as User;

    const result = await getOrCreateDirectChatRoom("lost", 1, suspended);

    expect(result).toEqual({ kind: "forbidden", reason: "suspended" });
    expect(lostPostTable.findUnique).not.toHaveBeenCalled();
    expect(chatRoom.create).not.toHaveBeenCalled();
  });

  it("returns not_found for a nonexistent post (also covers a deleted post -- same DB row absence)", async () => {
    lostPostTable.findUnique.mockResolvedValueOnce(null);

    const result = await getOrCreateDirectChatRoom("lost", 999, viewer);

    expect(result).toEqual({ kind: "not_found" });
    expect(chatRoom.create).not.toHaveBeenCalled();
  });

  it("returns the existing room instead of creating a duplicate (idempotent)", async () => {
    lostPostTable.findUnique.mockResolvedValueOnce({ id: 1, userId: lostOwner });
    chatRoom.findUnique.mockResolvedValueOnce({ id: 200 }); // existing room found by the unique constraint
    chatRoom.findUnique.mockResolvedValueOnce(roomDirect()); // findChatRoomRow(200)

    const result = await getOrCreateDirectChatRoom("lost", 1, viewer);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.id).toBe(200);
    expect(chatRoom.create).not.toHaveBeenCalled();
    expect(chatRoom.findUnique).toHaveBeenNthCalledWith(1, {
      where: { directLostPostId_initiatorUserId: { directLostPostId: 1, initiatorUserId: stranger } },
    });
  });

  it("resolves a concurrent duplicate-creation race by returning the winning room", async () => {
    lostPostTable.findUnique.mockResolvedValueOnce({ id: 1, userId: lostOwner });
    chatRoom.findUnique.mockResolvedValueOnce(null); // no existing room seen at first
    chatRoom.create.mockRejectedValueOnce(new FakePrismaClientKnownRequestError("P2002"));
    chatRoom.findUnique.mockResolvedValueOnce({ id: 200 }); // the other request's winner
    chatRoom.findUnique.mockResolvedValueOnce(roomDirect()); // findChatRoomRow(200)

    const result = await getOrCreateDirectChatRoom("lost", 1, viewer);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.id).toBe(200);
  });

  // Requirement: "여러 번 호출해도 ChatRoom 하나만 존재" -- calling twice
  // in sequence must only ever INSERT once; the second call must take the
  // idempotent get-existing path.
  it("only ever creates one room across repeated calls for the same (post, viewer) pair", async () => {
    lostPostTable.findUnique.mockResolvedValue({ id: 1, userId: lostOwner });
    chatRoom.findUnique.mockResolvedValueOnce(null);
    chatRoom.create.mockResolvedValueOnce({ id: 200 });
    chatRoom.findUnique.mockResolvedValueOnce(roomDirect());

    const first = await getOrCreateDirectChatRoom("lost", 1, viewer);

    chatRoom.findUnique.mockResolvedValueOnce({ id: 200 }); // now exists
    chatRoom.findUnique.mockResolvedValueOnce(roomDirect());

    const second = await getOrCreateDirectChatRoom("lost", 1, viewer);

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind === "ok" && second.kind === "ok") {
      expect(first.data.id).toBe(second.data.id);
    }
    expect(chatRoom.create).toHaveBeenCalledTimes(1);
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

  // Phase 10: direct rooms go through the same access-control path.
  it("returns a direct room for the initiator", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomDirect());
    userTable.findUnique.mockResolvedValueOnce({ id: lostOwner, nickname: "분실자" });

    const result = await getChatRoomForUser(200, stranger);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok" && result.data.roomType === "direct") {
      expect(result.data.counterpart.id).toBe(lostOwner);
      expect(result.data.post.id).toBe(1);
    }
  });

  it("returns a direct room for the post's author (the other participant)", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomDirect());
    userTable.findUnique.mockResolvedValueOnce({ id: stranger, nickname: "방문자" });

    const result = await getChatRoomForUser(200, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok" && result.data.roomType === "direct") {
      expect(result.data.counterpart.id).toBe(stranger);
    }
  });

  it("rejects a third party for a direct room", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomDirect());

    const result = await getChatRoomForUser(200, 12345);

    expect(result).toEqual({ kind: "forbidden" });
  });
});

describe("listChatRoomsForUser", () => {
  // Phase 10: the user's match rooms and direct rooms are two separate
  // queries (merged afterward), so both calls need their own mock return.
  it("scopes the match-room query to rooms the user participates in via a Match", async () => {
    chatRoom.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await listChatRoomsForUser(lostOwner);

    expect(chatRoom.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { match: { OR: [{ lostPost: { userId: lostOwner } }, { foundPost: { userId: lostOwner } }] } },
      }),
    );
  });

  it("scopes the direct-room query to rooms where the user is the initiator or the post's owner", async () => {
    chatRoom.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await listChatRoomsForUser(lostOwner);

    expect(chatRoom.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          matchId: null,
          OR: [
            { initiatorUserId: lostOwner },
            { directLostPost: { userId: lostOwner } },
            { directFoundPost: { userId: lostOwner } },
          ],
        },
      }),
    );
  });

  it("includes both match and direct rooms in the returned list", async () => {
    chatRoom.findMany
      .mockResolvedValueOnce([{ ...roomWithMatch(), messages: [] }])
      .mockResolvedValueOnce([{ ...roomDirect(), messages: [] }]);

    const results = await listChatRoomsForUser(lostOwner);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.roomType).sort()).toEqual(["direct", "match"]);
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

  // Phase 10: direct-room participants send/receive exactly like a
  // Match room's participants -- same funnel (participantIdsOf), so a
  // third party is rejected the same way too.
  describe("direct rooms", () => {
    const initiator = { id: stranger, nickname: "방문자", isSuspended: false, suspendedUntil: null } as unknown as User;

    it("lets the initiator send a message and notifies the post's author", async () => {
      chatRoom.findUnique.mockResolvedValueOnce(roomDirect());
      txMessageCreate.mockResolvedValueOnce({
        id: 1,
        senderUserId: stranger,
        content: "안녕하세요",
        createdAt: new Date(),
        readAt: null,
        sender: { nickname: "방문자" },
      });

      const result = await sendMessage(200, initiator, "안녕하세요");

      expect(result.kind).toBe("ok");
      expect(txNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: lostOwner, relatedId: 1 }) }),
      );
    });

    it("lets the post's author send a message and notifies the initiator", async () => {
      chatRoom.findUnique.mockResolvedValueOnce(roomDirect());
      txMessageCreate.mockResolvedValueOnce({
        id: 2,
        senderUserId: lostOwner,
        content: "네 안녕하세요",
        createdAt: new Date(),
        readAt: null,
        sender: { nickname: "닉네임" },
      });

      await sendMessage(200, sender, "네 안녕하세요");

      expect(txNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: stranger, relatedId: 2 }) }),
      );
    });

    it("rejects a third party -- not the initiator, not the post's author", async () => {
      chatRoom.findUnique.mockResolvedValueOnce(roomDirect());
      const thirdParty = { id: 12345, nickname: "제3자", isSuspended: false, suspendedUntil: null } as unknown as User;

      const result = await sendMessage(200, thirdParty, "안녕하세요");

      expect(result).toEqual({ kind: "forbidden" });
      expect($transaction).not.toHaveBeenCalled();
    });
  });
});

// Phase 11: notification deep-linking reads a message's chatRoomId
// through this -- deliberately returns nothing but id/chatRoomId (no
// content, no sender) since it performs no authorization of its own;
// callers re-derive real access via getChatRoomForUser().
describe("getMessage", () => {
  it("returns the message's id and chatRoomId", async () => {
    message.findUnique.mockResolvedValueOnce({ id: 42, chatRoomId: 100 });

    const result = await getMessage(42);

    expect(result).toEqual({ id: 42, chatRoomId: 100 });
    expect(message.findUnique).toHaveBeenCalledWith({
      where: { id: 42 },
      select: { id: true, chatRoomId: true },
    });
  });

  it("returns null for a nonexistent message", async () => {
    message.findUnique.mockResolvedValueOnce(null);
    expect(await getMessage(999)).toBeNull();
  });
});
