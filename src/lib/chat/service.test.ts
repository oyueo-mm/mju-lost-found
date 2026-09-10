import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/generated/prisma/client";

class FakePrismaClientKnownRequestError extends Error {
  code: string;
  constructor(code: string) {
    super("mock prisma error");
    this.code = code;
  }
}

const chatRoom = { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() };
const message = {
  findMany: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
};
const userTable = { findUnique: vi.fn() };
const notification = { updateMany: vi.fn() };
const lostPostTable = { findUnique: vi.fn() };
const foundPostTable = { findUnique: vi.fn() };
// Phase 12-9: getOrCreateDirectChatRoom's own commentId resolution.
const commentTable = { findUnique: vi.fn() };
// Phase D-4
const messageReaction = { deleteMany: vi.fn(), create: vi.fn(), findMany: vi.fn() };
// Phase N
const chatRead = { findUnique: vi.fn(), upsert: vi.fn() };
const $queryRaw = vi.fn();
const txMessageCreate = vi.fn();
const txNotificationCreate = vi.fn();
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({ message: { create: txMessageCreate }, notification: { create: txNotificationCreate } }),
);

// Phase J-2: no `match` key at all on the mocked prisma object -- if any
// chat code path still touched prisma.match, it would throw "Cannot read
// properties of undefined", proving the Match domain is genuinely gone
// from this service.
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    chatRoom,
    message,
    messageReaction,
    chatRead,
    user: userTable,
    notification,
    lostPost: lostPostTable,
    foundPost: foundPostTable,
    comment: commentTable,
    $transaction,
    $queryRaw,
  },
}));
vi.mock("@/generated/prisma/client", () => ({
  NotificationType: { MESSAGE: "MESSAGE" },
  Prisma: { PrismaClientKnownRequestError: FakePrismaClientKnownRequestError },
}));
vi.mock("@/lib/auth/suspension", () => ({
  isCurrentlySuspended: (user: { isSuspended?: boolean }) => Boolean(user?.isSuspended),
}));
// Phase 28-3: sendMessage()'s own image-path re-validation -- mocked
// wholesale (same convention every other collaborator in this file
// follows) so these tests control exactly what a "valid" vs "wrong room"
// path looks like without depending on the real regex.
const parseChatImagePathname = vi.fn();
const publicUrlFor = vi.fn();
// Phase 10B: deleteMessage()'s own self-delete image cleanup.
const deleteObjectSafely = vi.fn();
vi.mock("@/lib/images/pathname", () => ({ parseChatImagePathname }));
vi.mock("@/lib/images/supabaseAdmin", () => ({ publicUrlFor, deleteObjectSafely }));
// Phase N: every write path (sendMessage/toggleMessageReaction/
// markChatRoomRead) fires a best-effort realtime broadcast -- mocked
// wholesale here (same convention as every other collaborator in this
// file) so these tests never attempt a real network call; a few targeted
// tests below assert it was actually invoked with the right payload.
const broadcastChatEvent = vi.fn();
vi.mock("@/lib/chat/realtimeAdmin", () => ({ broadcastChatEvent }));

const {
  countUnreadMessagesForUser,
  deleteMessage,
  editMessage,
  getChatRoomForAdmin,
  getChatRoomForUser,
  getChatRoomParticipantIds,
  getMessage,
  getOrCreateDirectChatRoom,
  listChatRoomsForUser,
  listMessages,
  markChatRoomRead,
  markMessageNotificationsReadForChatRoom,
  sendMessage,
  toggleMessageReaction,
} = await import("./service");

const lostOwner = 1;
const foundOwner = 2;
const stranger = 999;

function postRef(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, userId: lostOwner, title: "지갑 분실", ...overrides };
}

// The stock room for message-level tests: LostPost id=1's owner
// (lostOwner) and foundOwner are its two participants. Phase J-2: this
// used to be a Match-based room; it's a direct room now (the only shape
// left), with the exact same two participants so every message/reaction/
// read-state test below keeps asserting on the same ids as before.
function roomForOwners(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 100,
    initiatorUserId: foundOwner,
    // Phase 12-9: always populated on the real row now -- see
    // ChatRoom.counterpartUserId's own comment. Same value
    // resolveDetailDTO/participantIdsOf used to derive on the fly from
    // directLostPost.userId, so every existing test keeps asserting on
    // the same two participants as before.
    counterpartUserId: lostOwner,
    createdAt: new Date("2026-01-01"),
    directLostPost: postRef({ id: 1, userId: lostOwner, title: "지갑 분실" }),
    directFoundPost: null,
    ...overrides,
  };
}

// Phase 10: a direct room -- `stranger` (the viewer) messaged LostPost
// id=1's owner (lostOwner) directly.
function roomDirect(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 200,
    initiatorUserId: stranger,
    counterpartUserId: lostOwner,
    createdAt: new Date("2026-01-01"),
    directLostPost: postRef({ id: 1, userId: lostOwner, title: "지갑 분실" }),
    directFoundPost: null,
    ...overrides,
  };
}

const sender = { id: lostOwner, nickname: "닉네임", isSuspended: false, suspendedUntil: null } as unknown as User;

beforeEach(() => {
  vi.clearAllMocks();
  userTable.findUnique.mockResolvedValue({ id: foundOwner, nickname: "상대닉네임" });
  publicUrlFor.mockImplementation((path: string) => `https://storage.example/post-images/${path}`);
  // Phase D-4: listMessages() always batches a reaction query for the
  // page it just fetched -- default to "no reactions" so every
  // pre-existing test in this file (written before reactions existed)
  // doesn't need its own irrelevant mock just to avoid this resolving to
  // undefined. Tests that actually care about reactions override this
  // with their own mockResolvedValueOnce.
  messageReaction.findMany.mockResolvedValue([]);
  // Phase N: listMessages() always looks up the counterpart's read cursor
  // -- default to "never read anything" (no ChatRead row yet) for the
  // same "pre-existing tests don't need their own irrelevant mock" reason
  // as messageReaction.findMany above. Tests that actually care about
  // readByCounterpart override this with their own mockResolvedValueOnce.
  chatRead.findUnique.mockResolvedValue(null);
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
      data: { directLostPostId: 1, initiatorUserId: stranger, counterpartUserId: lostOwner },
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
      data: { directFoundPostId: 5, initiatorUserId: stranger, counterpartUserId: foundOwner },
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
      where: {
        directLostPostId_initiatorUserId_counterpartUserId: {
          directLostPostId: 1,
          initiatorUserId: stranger,
          counterpartUserId: lostOwner,
        },
      },
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

  // Phase 12-9 §3/§4: commentId lets the counterpart be that comment's
  // own actual author instead of the post's own author -- never a raw
  // userId the client could claim.
  describe("commentId -- chat with a comment's actual author", () => {
    it("creates a room with the comment's author, not the post's author", async () => {
      lostPostTable.findUnique.mockResolvedValueOnce({ id: 1, userId: lostOwner });
      commentTable.findUnique.mockResolvedValueOnce({ authorUserId: foundOwner, lostPostId: 1, foundPostId: null });
      chatRoom.findUnique.mockResolvedValueOnce(null);
      chatRoom.create.mockResolvedValueOnce({ id: 300 });
      chatRoom.findUnique.mockResolvedValueOnce(
        roomDirect({ id: 300, initiatorUserId: stranger, counterpartUserId: foundOwner }),
      );

      const result = await getOrCreateDirectChatRoom("lost", 1, viewer, 55);

      expect(result.kind).toBe("ok");
      expect(chatRoom.create).toHaveBeenCalledWith({
        data: { directLostPostId: 1, initiatorUserId: stranger, counterpartUserId: foundOwner },
        select: { id: true },
      });
    });

    it("rejects chatting with yourself even via a commentId (self-comment)", async () => {
      lostPostTable.findUnique.mockResolvedValueOnce({ id: 1, userId: lostOwner });
      commentTable.findUnique.mockResolvedValueOnce({ authorUserId: stranger, lostPostId: 1, foundPostId: null });

      const result = await getOrCreateDirectChatRoom("lost", 1, viewer, 55);

      expect(result).toEqual({ kind: "forbidden", reason: "self" });
      expect(chatRoom.create).not.toHaveBeenCalled();
    });

    it("returns not_found for a nonexistent commentId", async () => {
      lostPostTable.findUnique.mockResolvedValueOnce({ id: 1, userId: lostOwner });
      commentTable.findUnique.mockResolvedValueOnce(null);

      const result = await getOrCreateDirectChatRoom("lost", 1, viewer, 999);

      expect(result).toEqual({ kind: "not_found" });
      expect(chatRoom.create).not.toHaveBeenCalled();
    });

    it("returns not_found when the comment belongs to a different post", async () => {
      lostPostTable.findUnique.mockResolvedValueOnce({ id: 1, userId: lostOwner });
      commentTable.findUnique.mockResolvedValueOnce({ authorUserId: foundOwner, lostPostId: 999, foundPostId: null });

      const result = await getOrCreateDirectChatRoom("lost", 1, viewer, 55);

      expect(result).toEqual({ kind: "not_found" });
      expect(chatRoom.create).not.toHaveBeenCalled();
    });

    it("reuses the existing room for the same (post, initiator, comment author) triple", async () => {
      lostPostTable.findUnique.mockResolvedValueOnce({ id: 1, userId: lostOwner });
      commentTable.findUnique.mockResolvedValueOnce({ authorUserId: foundOwner, lostPostId: 1, foundPostId: null });
      chatRoom.findUnique.mockResolvedValueOnce({ id: 300 });
      chatRoom.findUnique.mockResolvedValueOnce(
        roomDirect({ id: 300, initiatorUserId: stranger, counterpartUserId: foundOwner }),
      );

      const result = await getOrCreateDirectChatRoom("lost", 1, viewer, 55);

      expect(result.kind).toBe("ok");
      expect(chatRoom.create).not.toHaveBeenCalled();
      expect(chatRoom.findUnique).toHaveBeenNthCalledWith(1, {
        where: {
          directLostPostId_initiatorUserId_counterpartUserId: {
            directLostPostId: 1,
            initiatorUserId: stranger,
            counterpartUserId: foundOwner,
          },
        },
      });
    });

    // A second, different commenter on the same post must get their own
    // room, never collide with (or overwrite) the first comment-author
    // room -- this is the exact bug the old (post, initiator)-only
    // uniqueness couldn't prevent.
    it("a different comment author on the same post gets a separate room", async () => {
      const thirdUser = 777;
      lostPostTable.findUnique.mockResolvedValueOnce({ id: 1, userId: lostOwner });
      commentTable.findUnique.mockResolvedValueOnce({ authorUserId: thirdUser, lostPostId: 1, foundPostId: null });
      chatRoom.findUnique.mockResolvedValueOnce(null); // no existing room for (1, stranger, thirdUser)
      chatRoom.create.mockResolvedValueOnce({ id: 301 });
      chatRoom.findUnique.mockResolvedValueOnce(
        roomDirect({ id: 301, initiatorUserId: stranger, counterpartUserId: thirdUser }),
      );

      const result = await getOrCreateDirectChatRoom("lost", 1, viewer, 66);

      expect(result.kind).toBe("ok");
      expect(chatRoom.create).toHaveBeenCalledWith({
        data: { directLostPostId: 1, initiatorUserId: stranger, counterpartUserId: thirdUser },
        select: { id: true },
      });
    });
  });
});

describe("getChatRoomForUser", () => {
  it("returns not_found for a nonexistent room", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(null);
    expect(await getChatRoomForUser(999, lostOwner)).toEqual({ kind: "not_found" });
  });

  it("rejects a user who isn't a participant (A's room ID known by B)", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());

    const result = await getChatRoomForUser(100, stranger);

    expect(result).toEqual({ kind: "forbidden" });
  });

  it("returns the room for an actual participant", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());

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

// Phase 11-1: admin-only read view, deliberately not gated by
// participantIds (unlike getChatRoomForUser above, which this test suite
// never touches) -- a non-participant admin can read any room.
describe("getChatRoomForAdmin", () => {
  it("returns null for a nonexistent room", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(null);
    expect(await getChatRoomForAdmin(999)).toBeNull();
  });

  it("returns both participants and every message, for a non-participant admin", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    userTable.findUnique
      .mockResolvedValueOnce({ id: lostOwner, nickname: "분실자", publicId: "pub-1" })
      .mockResolvedValueOnce({ id: foundOwner, nickname: "습득자", publicId: "pub-2" });
    message.findMany.mockResolvedValueOnce([
      {
        id: 1,
        senderUserId: lostOwner,
        content: "안녕하세요",
        imageUrl: null,
        hiddenAt: null,
        hiddenByUserId: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        sender: { nickname: "분실자" },
      },
    ]);

    const room = await getChatRoomForAdmin(100);

    expect(room).not.toBeNull();
    expect(room?.post).toEqual({ id: 1, type: "lost", title: "지갑 분실" });
    expect(room?.participants).toEqual([
      { id: lostOwner, nickname: "분실자", publicId: "pub-1" },
      { id: foundOwner, nickname: "습득자", publicId: "pub-2" },
    ]);
    expect(room?.messages).toEqual([
      {
        id: 1,
        senderUserId: lostOwner,
        senderNickname: "분실자",
        content: "안녕하세요",
        imageUrl: null,
        isDeleted: false,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
  });

  // Same masking rule every other read path in this file already follows
  // -- a self-deleted or admin-hidden message's real content never
  // reaches this DTO either, even for an admin browsing for context.
  it("masks a hidden message's content the same way listMessages does", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    userTable.findUnique
      .mockResolvedValueOnce({ id: lostOwner, nickname: "분실자", publicId: "pub-1" })
      .mockResolvedValueOnce({ id: foundOwner, nickname: "습득자", publicId: "pub-2" });
    message.findMany.mockResolvedValueOnce([
      {
        id: 2,
        senderUserId: lostOwner,
        content: "삭제될 내용",
        imageUrl: "https://storage.example/post-images/chat/100/photo.jpg",
        hiddenAt: new Date("2026-01-02T00:00:00Z"),
        hiddenByUserId: lostOwner,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        sender: { nickname: "분실자" },
      },
    ]);

    const room = await getChatRoomForAdmin(100);

    expect(room?.messages[0]).toMatchObject({
      content: "삭제된 메시지입니다.",
      imageUrl: null,
      isDeleted: true,
    });
  });
});

// Phase D-2: the shared helper report/service.ts's message-report
// membership check calls -- same findChatRoomRow + participantIdsOf
// funnel getChatRoomForUser above already exercises, just returning the
// raw Set (or null) instead of a full DTO/mutation-result.
describe("getChatRoomParticipantIds", () => {
  it("returns null for a nonexistent room", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(null);
    expect(await getChatRoomParticipantIds(999)).toBeNull();
  });

  it("returns both participants of a room the post's owner initiated against another owner", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());

    const ids = await getChatRoomParticipantIds(100);

    expect(ids).toEqual(new Set([lostOwner, foundOwner]));
  });

  it("returns both participants of a direct room", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomDirect());

    const ids = await getChatRoomParticipantIds(200);

    expect(ids).toEqual(new Set([lostOwner, stranger]));
  });
});

describe("listChatRoomsForUser", () => {
  // Phase J-2: one query now (the Match-room query went with the Match
  // domain) -- rooms are scoped to "the user is the initiator, or owns the
  // post the room is about".
  it("scopes the room query to rooms where the user is the initiator or the post's owner", async () => {
    chatRoom.findMany.mockResolvedValueOnce([]);

    await listChatRoomsForUser(lostOwner);

    expect(chatRoom.findMany).toHaveBeenCalledTimes(1);
    expect(chatRoom.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ initiatorUserId: lostOwner }, { counterpartUserId: lostOwner }],
        },
      }),
    );
  });

  it("returns every room the user participates in", async () => {
    chatRoom.findMany.mockResolvedValueOnce([
      { ...roomForOwners(), messages: [] },
      { ...roomDirect(), messages: [] },
    ]);

    const results = await listChatRoomsForUser(lostOwner);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.roomType)).toEqual(["direct", "direct"]);
    expect(results.map((r) => r.id).sort()).toEqual([100, 200]);
  });
});

// Phase 17: Navigation's chat-unread badge.
describe("countUnreadMessagesForUser", () => {
  it("returns 0 without querying messages when the user has no rooms at all", async () => {
    chatRoom.findMany.mockResolvedValueOnce([]);

    const count = await countUnreadMessagesForUser(lostOwner);

    expect(count).toBe(0);
    expect($queryRaw).not.toHaveBeenCalled();
  });

  // Phase N: the threshold is now requesterId's own ChatRead cursor (a
  // LEFT JOIN, since a never-opened room has no ChatRead row yet -- see
  // countUnreadMessagesForUser's own comment), so this is a single raw
  // query rather than a plain prisma.message.count() with one fixed
  // readAt: null condition.
  it("counts unread messages across the user's rooms via the cursor-aware raw query", async () => {
    chatRoom.findMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    $queryRaw.mockResolvedValueOnce([{ count: BigInt(3) }]);

    const count = await countUnreadMessagesForUser(lostOwner);

    expect(count).toBe(3);
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns 0 when the raw query yields no rows", async () => {
    chatRoom.findMany.mockResolvedValueOnce([{ id: 1 }]);
    $queryRaw.mockResolvedValueOnce([]);

    const count = await countUnreadMessagesForUser(lostOwner);

    expect(count).toBe(0);
  });
});

describe("listMessages", () => {
  it("returns not_found for a nonexistent room", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(null);
    expect(await listMessages(999, lostOwner)).toEqual({ kind: "not_found" });
  });

  it("rejects a non-participant (A's room ID known by B)", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());

    const result = await listMessages(100, stranger);

    expect(result).toEqual({ kind: "forbidden" });
    expect(message.findMany).not.toHaveBeenCalled();
  });

  it("returns messages oldest-first even though the DB query orders newest-first", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
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
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findMany.mockResolvedValueOnce([
      { id: 1, senderUserId: lostOwner, content: "c1", createdAt: new Date(), readAt: null, hiddenAt: null, sender: { nickname: "n" } },
    ]);

    const result = await listMessages(100, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.items[0].isMine).toBe(true);
  });

  // Phase N
  it("computes readByCounterpart from the *other* participant's cursor, never the requester's own", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findMany.mockResolvedValueOnce([
      { id: 1, senderUserId: lostOwner, content: "c1", createdAt: new Date(), readAt: null, hiddenAt: null, sender: { nickname: "n" } },
      { id: 2, senderUserId: lostOwner, content: "c2", createdAt: new Date(), readAt: null, hiddenAt: null, sender: { nickname: "n" } },
    ]);
    chatRead.findUnique.mockResolvedValueOnce({ lastReadMessageId: 1 });

    const result = await listMessages(100, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(chatRead.findUnique).toHaveBeenCalledWith({
      where: { chatRoomId_userId: { chatRoomId: 100, userId: foundOwner } },
      select: { lastReadMessageId: true },
    });
    const byId = new Map(result.data.items.map((m) => [m.id, m.readByCounterpart]));
    expect(byId.get(1)).toBe(true); // id 1 <= cursor 1
    expect(byId.get(2)).toBe(false); // id 2 > cursor 1
  });

  it("treats a missing ChatRead row (room never opened by the counterpart) as fully unread", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findMany.mockResolvedValueOnce([
      { id: 1, senderUserId: lostOwner, content: "c1", createdAt: new Date(), readAt: null, hiddenAt: null, sender: { nickname: "n" } },
    ]);
    chatRead.findUnique.mockResolvedValueOnce(null);

    const result = await listMessages(100, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.items[0].readByCounterpart).toBe(false);
  });

  // Phase N: verified for real against the live (not-yet-migrated)
  // production DB during this phase's own implementation -- the ChatRead
  // table genuinely doesn't exist there yet (migration deliberately not
  // applied this phase), and listMessages() must keep working regardless,
  // same "never let a missing/broken piece take down the whole feature"
  // rule the read-marking calls in the API route already followed.
  it("degrades to readByCounterpart: false for everyone, without throwing, if the ChatRead lookup itself fails", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findMany.mockResolvedValueOnce([
      { id: 1, senderUserId: lostOwner, content: "c1", createdAt: new Date(), readAt: null, hiddenAt: null, sender: { nickname: "n" } },
    ]);
    chatRead.findUnique.mockRejectedValueOnce(new Error('The table "public.ChatRead" does not exist'));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await listMessages(100, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.items[0].readByCounterpart).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("masks hidden message content", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findMany.mockResolvedValueOnce([
      { id: 1, senderUserId: foundOwner, content: "real content", createdAt: new Date(), readAt: null, hiddenAt: new Date(), sender: { nickname: "n" } },
    ]);

    const result = await listMessages(100, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.items[0].content).toBe("[관리자에 의해 숨겨진 메시지입니다.]");
  });

  // Phase 28-3
  it("passes an image message's imageUrl through unmasked", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findMany.mockResolvedValueOnce([
      {
        id: 1,
        senderUserId: lostOwner,
        content: "",
        imageUrl: "https://x/y.jpg",
        createdAt: new Date(),
        readAt: null,
        hiddenAt: null,
        sender: { nickname: "n" },
      },
    ]);

    const result = await listMessages(100, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.items[0].imageUrl).toBe("https://x/y.jpg");
  });

  it("masks a hidden message's image too, not just its text", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findMany.mockResolvedValueOnce([
      {
        id: 1,
        senderUserId: foundOwner,
        content: "real content",
        imageUrl: "https://x/y.jpg",
        createdAt: new Date(),
        readAt: null,
        hiddenAt: new Date(),
        sender: { nickname: "n" },
      },
    ]);

    const result = await listMessages(100, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.items[0].imageUrl).toBeNull();
  });

  // Phase D-3
  it("includes a masked preview of the replied-to message when it's hidden", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findMany.mockResolvedValueOnce([
      {
        id: 2,
        senderUserId: lostOwner,
        content: "네 맞아요",
        createdAt: new Date(),
        readAt: null,
        hiddenAt: null,
        sender: { nickname: "n" },
        replyToMessage: {
          id: 1,
          content: "원본 내용",
          imageUrl: null,
          hiddenAt: new Date(),
          // Admin-hidden, not self-deleted: hiddenByUserId (an admin, here
          // just any id distinct from the sender) differs from
          // senderUserId -- see maskedContent()'s own disambiguation.
          hiddenByUserId: 42,
          senderUserId: foundOwner,
          sender: { nickname: "상대방" },
        },
      },
    ]);

    const result = await listMessages(100, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.items[0].replyTo).toEqual({
        id: 1,
        senderNickname: "상대방",
        content: "[관리자에 의해 숨겨진 메시지입니다.]",
        hasImage: false,
      });
    }
  });

  // Phase D-4
  it("groups reaction rows into one summary per distinct emoji, marking which are the requester's own", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findMany.mockResolvedValueOnce([
      { id: 1, senderUserId: lostOwner, content: "c1", createdAt: new Date(), readAt: null, hiddenAt: null, sender: { nickname: "n" } },
    ]);
    messageReaction.findMany.mockResolvedValueOnce([
      { messageId: 1, emoji: "👍", userId: lostOwner },
      { messageId: 1, emoji: "👍", userId: foundOwner },
      { messageId: 1, emoji: "❤️", userId: foundOwner },
    ]);

    const result = await listMessages(100, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.items[0].reactions).toEqual([
        { emoji: "👍", count: 2, reactedByMe: true },
        { emoji: "❤️", count: 1, reactedByMe: false },
      ]);
    }
  });

  it("returns an empty reactions array for a message nobody reacted to", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findMany.mockResolvedValueOnce([
      { id: 1, senderUserId: lostOwner, content: "c1", createdAt: new Date(), readAt: null, hiddenAt: null, sender: { nickname: "n" } },
    ]);
    messageReaction.findMany.mockResolvedValueOnce([]);

    const result = await listMessages(100, lostOwner);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.items[0].reactions).toEqual([]);
  });

  it("reports hasMore via the limit+1 lookahead", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
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
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findMany.mockResolvedValueOnce([]);

    await listMessages(100, lostOwner, 50);

    expect(message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chatRoomId: 100, id: { lt: 50 } } }),
    );
  });
});

// Phase N: replaces the old markMessagesAsRead (bulk-UPDATE-every-
// unread-message) with a single upsert of the requester's own read
// cursor, advanced to the room's current latest message id.
describe("markChatRoomRead", () => {
  it("rejects a non-participant", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());

    const result = await markChatRoomRead(100, stranger);

    expect(result).toEqual({ kind: "forbidden" });
    expect(chatRead.upsert).not.toHaveBeenCalled();
  });

  it("is a no-op (no ChatRead row written) when the room has no messages yet", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findFirst.mockResolvedValueOnce(null);

    const result = await markChatRoomRead(100, lostOwner);

    expect(result).toEqual({ kind: "ok", data: { lastReadMessageId: null } });
    expect(chatRead.upsert).not.toHaveBeenCalled();
    expect(broadcastChatEvent).not.toHaveBeenCalled();
  });

  it("advances the requester's own cursor to the room's latest message id", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findFirst.mockResolvedValueOnce({ id: 42 });
    chatRead.upsert.mockResolvedValueOnce({ lastReadMessageId: 42 });

    const result = await markChatRoomRead(100, lostOwner);

    expect(result).toEqual({ kind: "ok", data: { lastReadMessageId: 42 } });
    expect(chatRead.upsert).toHaveBeenCalledWith({
      where: { chatRoomId_userId: { chatRoomId: 100, userId: lostOwner } },
      create: { chatRoomId: 100, userId: lostOwner, lastReadMessageId: 42 },
      update: { lastReadMessageId: 42 },
    });
  });

  it("broadcasts a content-free 'read' event with the requester's id and new cursor", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findFirst.mockResolvedValueOnce({ id: 42 });
    chatRead.upsert.mockResolvedValueOnce({ lastReadMessageId: 42 });

    await markChatRoomRead(100, lostOwner);

    expect(broadcastChatEvent).toHaveBeenCalledWith(100, {
      event: "read",
      payload: { userId: lostOwner, lastReadMessageId: 42 },
    });
  });
});

describe("markMessageNotificationsReadForChatRoom", () => {
  it("rejects a non-participant", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());

    const result = await markMessageNotificationsReadForChatRoom(100, stranger);

    expect(result).toEqual({ kind: "forbidden" });
  });

  it("scopes the update to the requester's own message-type notifications for this room's messages", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
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
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    const strangerUser = { ...sender, id: stranger } as unknown as User;

    const result = await sendMessage(100, strangerUser, "안녕");

    expect(result).toEqual({ kind: "forbidden" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("rejects a suspended participant", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    const suspended = { ...sender, isSuspended: true } as unknown as User;

    const result = await sendMessage(100, suspended, "안녕");

    expect(result).toEqual({ kind: "forbidden" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("rejects a blank/whitespace-only message", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());

    const result = await sendMessage(100, sender, "   ");

    expect(result).toEqual({ kind: "invalid_content" });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("sets the sender to the authenticated user, never a caller-supplied id", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
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
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
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

  // Phase N
  it("broadcasts a content-free 'message' event with the new message's bare id", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    txMessageCreate.mockResolvedValueOnce({
      id: 7,
      senderUserId: lostOwner,
      content: "안녕하세요",
      createdAt: new Date(),
      readAt: null,
      sender: { nickname: "닉네임" },
    });

    await sendMessage(100, sender, "안녕하세요");

    expect(broadcastChatEvent).toHaveBeenCalledWith(100, { event: "message", payload: { messageId: 7 } });
  });

  // Defensive: getOrCreateDirectChatRoom() rejects self-chat at creation
  // time, so a room whose initiator is also the post's owner shouldn't
  // exist -- if one somehow did, sendMessage must simply not notify
  // anyone rather than notifying the sender about their own message.
  it("sends no notification when the sender is the room's only participant", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(
      roomForOwners({
        initiatorUserId: lostOwner,
        directLostPost: postRef({ id: 1, userId: lostOwner }),
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
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    $transaction.mockRejectedValueOnce(new Error("connection lost"));

    await expect(sendMessage(100, sender, "안녕하세요")).rejects.toThrow("connection lost");
  });

  // Phase 28-3: image messages -- imagePath is only ever a Storage path
  // the client already uploaded (never a trusted URL), re-validated here
  // against the chat room it's actually being sent to.
  describe("image messages", () => {
    it("rejects an imagePath that doesn't parse as a valid chat image pathname", async () => {
      chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
      parseChatImagePathname.mockReturnValueOnce(null);

      const result = await sendMessage(100, sender, "", "not-a-real-path.jpg");

      expect(result).toEqual({ kind: "invalid_image" });
      expect($transaction).not.toHaveBeenCalled();
    });

    it("rejects an imagePath that names a different chat room (never trusts the client)", async () => {
      chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
      parseChatImagePathname.mockReturnValueOnce({ chatRoomId: 999 });

      const result = await sendMessage(100, sender, "", "chat/999/y.jpg");

      expect(result).toEqual({ kind: "invalid_image" });
      expect($transaction).not.toHaveBeenCalled();
    });

    it("sends an image-only message (empty content is allowed when an image is attached)", async () => {
      chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
      parseChatImagePathname.mockReturnValueOnce({ chatRoomId: 100 });
      txMessageCreate.mockResolvedValueOnce({
        id: 1,
        senderUserId: lostOwner,
        content: "",
        imageUrl: "https://storage.example/post-images/chat/100/y.jpg",
        createdAt: new Date(),
        readAt: null,
        sender: { nickname: "닉네임" },
      });

      const result = await sendMessage(100, sender, "", "chat/100/y.jpg");

      expect(result.kind).toBe("ok");
      expect(txMessageCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: "",
            imageUrl: "https://storage.example/post-images/chat/100/y.jpg",
          }),
        }),
      );
      if (result.kind === "ok") {
        expect(result.data.imageUrl).toBe("https://storage.example/post-images/chat/100/y.jpg");
      }
    });

    it("sends text + image together", async () => {
      chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
      parseChatImagePathname.mockReturnValueOnce({ chatRoomId: 100 });
      txMessageCreate.mockResolvedValueOnce({
        id: 1,
        senderUserId: lostOwner,
        content: "이거 본인 물건 맞나요?",
        imageUrl: "https://storage.example/post-images/chat/100/y.jpg",
        createdAt: new Date(),
        readAt: null,
        sender: { nickname: "닉네임" },
      });

      await sendMessage(100, sender, "이거 본인 물건 맞나요?", "chat/100/y.jpg");

      expect(txMessageCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: "이거 본인 물건 맞나요?",
            imageUrl: "https://storage.example/post-images/chat/100/y.jpg",
          }),
        }),
      );
    });

    it("still rejects an empty message when there's no image either", async () => {
      chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());

      const result = await sendMessage(100, sender, "   ", undefined);

      expect(result).toEqual({ kind: "invalid_content" });
      expect($transaction).not.toHaveBeenCalled();
    });
  });

  // Phase D-3
  describe("replies", () => {
    it("creates a reply and echoes back a preview of the message it replies to", async () => {
      chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
      message.findUnique.mockResolvedValueOnce({
        id: 5,
        chatRoomId: 100,
        content: "원본 메시지",
        imageUrl: null,
        hiddenAt: null,
        sender: { nickname: "상대방" },
      });
      txMessageCreate.mockResolvedValueOnce({
        id: 6,
        senderUserId: lostOwner,
        content: "네 맞아요",
        imageUrl: null,
        createdAt: new Date(),
        readAt: null,
        sender: { nickname: "닉네임" },
      });

      const result = await sendMessage(100, sender, "네 맞아요", undefined, 5);

      expect(result.kind).toBe("ok");
      expect(txMessageCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ replyToMessageId: 5 }) }),
      );
      if (result.kind === "ok") {
        expect(result.data.replyTo).toEqual({
          id: 5,
          senderNickname: "상대방",
          content: "원본 메시지",
          hasImage: false,
        });
      }
    });

    it("rejects a replyToMessageId that doesn't exist", async () => {
      chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
      message.findUnique.mockResolvedValueOnce(null);

      const result = await sendMessage(100, sender, "네 맞아요", undefined, 999);

      expect(result).toEqual({ kind: "invalid_reply" });
      expect($transaction).not.toHaveBeenCalled();
    });

    // The core security check: a replyToMessageId is only ever trusted
    // when the target message's own (DB-read) chatRoomId matches the room
    // the new message is actually being sent to -- never whatever the
    // client implies by calling this chatRoomId's own endpoint.
    it("rejects a replyToMessageId belonging to a different chat room", async () => {
      chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
      message.findUnique.mockResolvedValueOnce({
        id: 5,
        chatRoomId: 999,
        content: "다른 방의 메시지",
        imageUrl: null,
        hiddenAt: null,
        sender: { nickname: "상대방" },
      });

      const result = await sendMessage(100, sender, "네 맞아요", undefined, 5);

      expect(result).toEqual({ kind: "invalid_reply" });
      expect($transaction).not.toHaveBeenCalled();
    });

    it("allows replying to an already-hidden message, with its preview masked the same way listMessages() masks it", async () => {
      chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
      message.findUnique.mockResolvedValueOnce({
        id: 5,
        chatRoomId: 100,
        content: "실제 원본 내용",
        imageUrl: "https://x/y.jpg",
        hiddenAt: new Date(),
        // Admin-hidden, not self-deleted -- see the identical comment on
        // listMessages' own "masked preview" test above.
        hiddenByUserId: 42,
        senderUserId: foundOwner,
        sender: { nickname: "상대방" },
      });
      txMessageCreate.mockResolvedValueOnce({
        id: 6,
        senderUserId: lostOwner,
        content: "네 맞아요",
        imageUrl: null,
        createdAt: new Date(),
        readAt: null,
        sender: { nickname: "닉네임" },
      });

      const result = await sendMessage(100, sender, "네 맞아요", undefined, 5);

      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.data.replyTo).toEqual({
          id: 5,
          senderNickname: "상대방",
          content: "[관리자에 의해 숨겨진 메시지입니다.]",
          hasImage: false,
        });
      }
    });

    it("a non-reply message has no replyTo (unchanged from before this phase)", async () => {
      chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
      txMessageCreate.mockResolvedValueOnce({
        id: 1,
        senderUserId: lostOwner,
        content: "그냥 메시지",
        createdAt: new Date(),
        readAt: null,
        sender: { nickname: "닉네임" },
      });

      const result = await sendMessage(100, sender, "그냥 메시지");

      expect(result.kind).toBe("ok");
      if (result.kind === "ok") expect(result.data.replyTo).toBeNull();
      expect(message.findUnique).not.toHaveBeenCalled();
    });
  });

  // Phase 10: a room started by a non-owner viewer (the initiator) rather
  // than by two post owners -- same funnel (participantIdsOf), so a third
  // party is rejected the same way too.
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

// Phase D-4
describe("toggleMessageReaction", () => {
  it("returns not_found for a nonexistent room", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(null);

    const result = await toggleMessageReaction(999, 1, "👍", sender);

    expect(result).toEqual({ kind: "not_found" });
    expect(messageReaction.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects a non-participant (A's room ID known by B)", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    const strangerUser = { ...sender, id: stranger } as unknown as User;

    const result = await toggleMessageReaction(100, 1, "👍", strangerUser);

    expect(result).toEqual({ kind: "forbidden" });
    expect(messageReaction.deleteMany).not.toHaveBeenCalled();
  });

  // Same "never trust a client-supplied id pairing" rule as sendMessage's
  // own replyToMessageId check -- a messageId that's real but belongs to
  // a different room is rejected the same way a nonexistent one is.
  it("rejects a messageId that doesn't exist", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce(null);

    const result = await toggleMessageReaction(100, 999, "👍", sender);

    expect(result).toEqual({ kind: "invalid_reaction" });
  });

  it("rejects a messageId belonging to a different chat room", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ chatRoomId: 999 });

    const result = await toggleMessageReaction(100, 1, "👍", sender);

    expect(result).toEqual({ kind: "invalid_reaction" });
  });

  it("adds a reaction when the requester hasn't picked this emoji yet (delete finds nothing)", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ chatRoomId: 100 });
    messageReaction.deleteMany.mockResolvedValueOnce({ count: 0 });
    messageReaction.findMany.mockResolvedValueOnce([{ emoji: "👍", userId: lostOwner }]);

    const result = await toggleMessageReaction(100, 1, "👍", sender);

    expect(messageReaction.create).toHaveBeenCalledWith({
      data: { messageId: 1, userId: lostOwner, emoji: "👍" },
    });
    expect(result).toEqual({
      kind: "ok",
      data: { messageId: 1, reactions: [{ emoji: "👍", count: 1, reactedByMe: true }] },
    });
  });

  // Phase N
  it("broadcasts a content-free 'reaction' event with just the message id", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ chatRoomId: 100 });
    messageReaction.deleteMany.mockResolvedValueOnce({ count: 0 });
    messageReaction.findMany.mockResolvedValueOnce([{ emoji: "👍", userId: lostOwner }]);

    await toggleMessageReaction(100, 1, "👍", sender);

    expect(broadcastChatEvent).toHaveBeenCalledWith(100, { event: "reaction", payload: { messageId: 1 } });
  });

  it("removes the reaction when the requester already picked this emoji (toggle off)", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ chatRoomId: 100 });
    messageReaction.deleteMany.mockResolvedValueOnce({ count: 1 });
    messageReaction.findMany.mockResolvedValueOnce([]);

    const result = await toggleMessageReaction(100, 1, "👍", sender);

    expect(messageReaction.deleteMany).toHaveBeenCalledWith({
      where: { messageId: 1, userId: lostOwner, emoji: "👍" },
    });
    expect(messageReaction.create).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "ok", data: { messageId: 1, reactions: [] } });
  });

  it("lets several different participants react to the same message with different emoji", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ chatRoomId: 100 });
    messageReaction.deleteMany.mockResolvedValueOnce({ count: 0 });
    messageReaction.findMany.mockResolvedValueOnce([
      { emoji: "👍", userId: foundOwner },
      { emoji: "❤️", userId: lostOwner },
    ]);

    const result = await toggleMessageReaction(100, 1, "❤️", sender);

    expect(result).toEqual({
      kind: "ok",
      data: {
        messageId: 1,
        reactions: [
          { emoji: "👍", count: 1, reactedByMe: false },
          { emoji: "❤️", count: 1, reactedByMe: true },
        ],
      },
    });
  });

  it("converts a concurrent UNIQUE violation (double-click race) into a successful add", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ chatRoomId: 100 });
    messageReaction.deleteMany.mockResolvedValueOnce({ count: 0 });
    messageReaction.create.mockRejectedValueOnce(new FakePrismaClientKnownRequestError("P2002"));
    messageReaction.findMany.mockResolvedValueOnce([{ emoji: "👍", userId: lostOwner }]);

    const result = await toggleMessageReaction(100, 1, "👍", sender);

    expect(result.kind).toBe("ok");
  });

  it("rethrows a non-P2002 error from the INSERT", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ chatRoomId: 100 });
    messageReaction.deleteMany.mockResolvedValueOnce({ count: 0 });
    messageReaction.create.mockRejectedValueOnce(new Error("db down"));

    await expect(toggleMessageReaction(100, 1, "👍", sender)).rejects.toThrow("db down");
  });

  // Phase D-4 spec: reactions are metadata, not content -- a hidden
  // message can still be reacted to (no hiddenAt check anywhere in
  // toggleMessageReaction), same "hidden never blocks an action" policy
  // reply/report already follow.
  it("allows reacting to an already-hidden message (reactions are metadata, not content)", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ chatRoomId: 100 });
    messageReaction.deleteMany.mockResolvedValueOnce({ count: 0 });
    messageReaction.findMany.mockResolvedValueOnce([{ emoji: "👍", userId: lostOwner }]);

    const result = await toggleMessageReaction(100, 1, "👍", sender);

    expect(result.kind).toBe("ok");
  });
});

// Phase P-6: editing the sender's own message text -- strictly self-only,
// no admin override (see editMessage's own comment on why that differs
// from deleteMessage below).
describe("editMessage", () => {
  it("returns not_found for a nonexistent room", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(null);

    const result = await editMessage(999, 1, lostOwner, "수정된 내용");

    expect(result).toEqual({ kind: "not_found" });
    expect(message.update).not.toHaveBeenCalled();
  });

  it("rejects a non-participant", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());

    const result = await editMessage(100, 1, stranger, "수정된 내용");

    expect(result).toEqual({ kind: "forbidden" });
    expect(message.update).not.toHaveBeenCalled();
  });

  it("rejects a messageId that doesn't belong to this chat room", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ id: 1, chatRoomId: 999, senderUserId: lostOwner, hiddenAt: null });

    const result = await editMessage(100, 1, lostOwner, "수정된 내용");

    expect(result).toEqual({ kind: "invalid_message" });
    expect(message.update).not.toHaveBeenCalled();
  });

  it("rejects editing another participant's message", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ id: 1, chatRoomId: 100, senderUserId: foundOwner, hiddenAt: null });

    const result = await editMessage(100, 1, lostOwner, "해킹 시도");

    expect(result).toEqual({ kind: "forbidden" });
    expect(message.update).not.toHaveBeenCalled();
  });

  it("rejects editing an already-hidden/deleted message", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({
      id: 1,
      chatRoomId: 100,
      senderUserId: lostOwner,
      hiddenAt: new Date(),
    });

    const result = await editMessage(100, 1, lostOwner, "수정된 내용");

    expect(result).toEqual({ kind: "invalid_message" });
    expect(message.update).not.toHaveBeenCalled();
  });

  it("rejects an empty (whitespace-only) edit", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ id: 1, chatRoomId: 100, senderUserId: lostOwner, hiddenAt: null });

    const result = await editMessage(100, 1, lostOwner, "   ");

    expect(result).toEqual({ kind: "invalid_content" });
    expect(message.update).not.toHaveBeenCalled();
  });

  it("edits the sender's own message, stamps editedAt, and broadcasts a 'message' realtime event", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ id: 1, chatRoomId: 100, senderUserId: lostOwner, hiddenAt: null });
    const editedAt = new Date();
    message.update.mockResolvedValueOnce({
      id: 1,
      senderUserId: lostOwner,
      content: "수정된 내용",
      imageUrl: null,
      createdAt: new Date("2026-01-01"),
      editedAt,
      sender: { nickname: "닉네임" },
      replyToMessage: null,
    });
    messageReaction.findMany.mockResolvedValueOnce([]);

    const result = await editMessage(100, 1, lostOwner, "  수정된 내용  ");

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.content).toBe("수정된 내용");
      expect(result.data.editedAt).toBe(editedAt);
    }
    expect(message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { content: "수정된 내용", editedAt: expect.any(Date) },
      }),
    );
    // Reuses the exact same "message" event sendMessage's own broadcast
    // uses -- ChatThread.tsx's syncLatest() already re-fetches-and-
    // upserts-by-id on it, so an edit needs no new realtime event type.
    expect(broadcastChatEvent).toHaveBeenCalledWith(100, { event: "message", payload: { messageId: 1 } });
  });
});

// Phase P-6: soft-deleting ("삭제") a message reuses the existing
// hiddenAt/hiddenByUserId columns (admin moderation's own "hide" fields) --
// see deleteMessage's own comment for why this isn't a new column/policy.
describe("deleteMessage", () => {
  it("returns not_found for a nonexistent room", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(null);

    const result = await deleteMessage(999, 1, sender);

    expect(result).toEqual({ kind: "not_found" });
    expect(message.update).not.toHaveBeenCalled();
  });

  it("rejects a non-participant", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());

    const result = await deleteMessage(100, 1, { ...sender, id: stranger } as unknown as User);

    expect(result).toEqual({ kind: "forbidden" });
    expect(message.update).not.toHaveBeenCalled();
  });

  it("rejects a messageId that doesn't belong to this chat room", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ chatRoomId: 999, senderUserId: lostOwner, hiddenAt: null });

    const result = await deleteMessage(100, 1, sender);

    expect(result).toEqual({ kind: "invalid_message" });
    expect(message.update).not.toHaveBeenCalled();
  });

  it("rejects deleting another participant's message when the requester isn't an admin", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ chatRoomId: 100, senderUserId: foundOwner, hiddenAt: null });

    const result = await deleteMessage(100, 1, { ...sender, isAdmin: false } as unknown as User);

    expect(result).toEqual({ kind: "forbidden" });
    expect(message.update).not.toHaveBeenCalled();
  });

  it("deletes the sender's own message and broadcasts a 'message' realtime event", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ chatRoomId: 100, senderUserId: lostOwner, hiddenAt: null });
    message.update.mockResolvedValueOnce({});

    const result = await deleteMessage(100, 1, sender);

    expect(result).toEqual({ kind: "ok", data: { messageId: 1 } });
    expect(message.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { hiddenAt: expect.any(Date), hiddenByUserId: lostOwner, hiddenReason: null },
    });
    expect(broadcastChatEvent).toHaveBeenCalledWith(100, { event: "message", payload: { messageId: 1 } });
  });

  // Phase P-6: mirrors posts/service.ts's deleteLostPost/deleteFoundPost's
  // own asAdmin bypass -- an existing admin capability pattern, not a new
  // one, and separate from (doesn't change) the report -> HIDE_MESSAGE flow.
  it("allows an admin to delete another participant's message", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ chatRoomId: 100, senderUserId: foundOwner, hiddenAt: null });
    message.update.mockResolvedValueOnce({});

    const admin = { ...sender, id: 77, isAdmin: true } as unknown as User;
    const result = await deleteMessage(100, 1, admin);

    expect(result).toEqual({ kind: "ok", data: { messageId: 1 } });
    expect(message.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { hiddenAt: expect.any(Date), hiddenByUserId: 77, hiddenReason: null },
    });
  });

  it("is idempotent -- deleting an already-hidden message succeeds without writing again or re-broadcasting", async () => {
    chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
    message.findUnique.mockResolvedValueOnce({ chatRoomId: 100, senderUserId: lostOwner, hiddenAt: new Date() });

    const result = await deleteMessage(100, 1, sender);

    expect(result).toEqual({ kind: "ok", data: { messageId: 1 } });
    expect(message.update).not.toHaveBeenCalled();
    expect(broadcastChatEvent).not.toHaveBeenCalled();
  });

  // Phase 10B: self-delete purges the actual Storage object, not just the
  // display -- see Phase 10A's retention policy (a self-deleted photo has
  // no remaining reason to stay in Storage, unlike an admin-hidden one).
  describe("self-delete image cleanup (Phase 10B)", () => {
    it("deletes the Storage object and nulls imageUrl when the sender deletes their own message with an image", async () => {
      chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
      message.findUnique.mockResolvedValueOnce({
        chatRoomId: 100,
        senderUserId: lostOwner,
        hiddenAt: null,
        imageUrl: "https://storage.example/post-images/chat/100/photo.jpg",
      });
      message.update.mockResolvedValueOnce({});

      const result = await deleteMessage(100, 1, sender);

      expect(result).toEqual({ kind: "ok", data: { messageId: 1 } });
      expect(message.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          hiddenAt: expect.any(Date),
          hiddenByUserId: lostOwner,
          hiddenReason: null,
          imageUrl: null,
        },
      });
      expect(deleteObjectSafely).toHaveBeenCalledWith("https://storage.example/post-images/chat/100/photo.jpg");
    });

    it("does not touch Storage for a self-deleted message with no image", async () => {
      chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
      message.findUnique.mockResolvedValueOnce({
        chatRoomId: 100,
        senderUserId: lostOwner,
        hiddenAt: null,
        imageUrl: null,
      });
      message.update.mockResolvedValueOnce({});

      await deleteMessage(100, 1, sender);

      expect(deleteObjectSafely).not.toHaveBeenCalled();
      expect(message.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { hiddenAt: expect.any(Date), hiddenByUserId: lostOwner, hiddenReason: null },
      });
    });

    // The admin-bypass path in this same function is still an admin
    // acting on someone else's message (hiddenByUserId !== senderUserId),
    // exactly like the separate moderation/service.ts HIDE_MESSAGE flow --
    // both preserve the image as potential evidence, per Phase 10A.
    it("preserves the image when an admin deletes another participant's message", async () => {
      chatRoom.findUnique.mockResolvedValueOnce(roomForOwners());
      message.findUnique.mockResolvedValueOnce({
        chatRoomId: 100,
        senderUserId: foundOwner,
        hiddenAt: null,
        imageUrl: "https://storage.example/post-images/chat/100/photo.jpg",
      });
      message.update.mockResolvedValueOnce({});

      const admin = { ...sender, id: 77, isAdmin: true } as unknown as User;
      const result = await deleteMessage(100, 1, admin);

      expect(result).toEqual({ kind: "ok", data: { messageId: 1 } });
      expect(deleteObjectSafely).not.toHaveBeenCalled();
      expect(message.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { hiddenAt: expect.any(Date), hiddenByUserId: 77, hiddenReason: null },
      });
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
