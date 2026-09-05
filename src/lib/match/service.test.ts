import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/generated/prisma/client";

class FakePrismaClientKnownRequestError extends Error {
  code: string;
  constructor(code: string) {
    super("mock prisma error");
    this.code = code;
  }
}

const lostPost = { findUnique: vi.fn() };
const foundPost = { findUnique: vi.fn() };
const match = { findUnique: vi.fn(), findMany: vi.fn(), delete: vi.fn() };
const txMatchCreate = vi.fn();
const txNotificationCreate = vi.fn();
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({ match: { create: txMatchCreate }, notification: { create: txNotificationCreate } }),
);

vi.mock("@/lib/db/prisma", () => ({ prisma: { lostPost, foundPost, match, $transaction } }));
vi.mock("@/generated/prisma/client", () => ({
  NotificationType: { MATCH: "MATCH" },
  Prisma: { PrismaClientKnownRequestError: FakePrismaClientKnownRequestError },
}));

const { createMatch, deleteMatch, getMatch, getOwnedPostRefForMatch, listMatchesForPost, listMatchesForUser } =
  await import("./service");

const requester = { id: 1, isSuspended: false, suspendedUntil: null } as unknown as User;

const matchRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 10,
  score: 1,
  createdAt: new Date("2026-01-01"),
  lostPost: { id: 1, title: "지갑 분실", imageUrl: null, userId: 1 },
  foundPost: { id: 2, title: "지갑 습득", imageUrl: null, userId: 2 },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createMatch", () => {
  it("creates a match when the requester owns the LostPost side", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    foundPost.findUnique.mockResolvedValueOnce({ id: 2, userId: 2 });
    match.findUnique.mockResolvedValueOnce(null); // no existing match
    txMatchCreate.mockResolvedValueOnce(matchRow());

    const result = await createMatch(requester, { lostPostId: 1, foundPostId: 2 });

    expect(result.kind).toBe("ok");
    expect(txMatchCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lostPostId: 1, foundPostId: 2, score: 1 }) }),
    );
  });

  it("creates a match when the requester owns only the FoundPost side", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 999 });
    foundPost.findUnique.mockResolvedValueOnce({ id: 2, userId: 1 });
    match.findUnique.mockResolvedValueOnce(null);
    txMatchCreate.mockResolvedValueOnce(matchRow());

    const result = await createMatch(requester, { lostPostId: 1, foundPostId: 2 });

    expect(result.kind).toBe("ok");
  });

  it("rejects a nonexistent LostPost", async () => {
    lostPost.findUnique.mockResolvedValueOnce(null);

    const result = await createMatch(requester, { lostPostId: 999, foundPostId: 2 });

    expect(result).toEqual({ kind: "lost_not_found" });
    expect(txMatchCreate).not.toHaveBeenCalled();
  });

  it("rejects a nonexistent FoundPost", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    foundPost.findUnique.mockResolvedValueOnce(null);

    const result = await createMatch(requester, { lostPostId: 1, foundPostId: 999 });

    expect(result).toEqual({ kind: "found_not_found" });
    expect(txMatchCreate).not.toHaveBeenCalled();
  });

  it("rejects a requester who owns neither side", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 999 });
    foundPost.findUnique.mockResolvedValueOnce({ id: 2, userId: 998 });

    const result = await createMatch(requester, { lostPostId: 1, foundPostId: 2 });

    expect(result).toEqual({ kind: "forbidden", reason: "not_owner" });
    expect(txMatchCreate).not.toHaveBeenCalled();
  });

  it("rejects a suspended user without touching the DB", async () => {
    const suspended = { ...requester, isSuspended: true } as unknown as User;

    const result = await createMatch(suspended, { lostPostId: 1, foundPostId: 2 });

    expect(result).toEqual({ kind: "forbidden", reason: "suspended" });
    expect(lostPost.findUnique).not.toHaveBeenCalled();
  });

  it("is idempotent: re-requesting an already-matched pair returns the existing match, not a new one", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    foundPost.findUnique.mockResolvedValueOnce({ id: 2, userId: 2 });
    match.findUnique.mockResolvedValueOnce(matchRow({ id: 55 }));

    const result = await createMatch(requester, { lostPostId: 1, foundPostId: 2 });

    expect(result).toEqual({ kind: "ok", data: expect.objectContaining({ id: 55 }) });
    expect(txMatchCreate).not.toHaveBeenCalled();
  });

  it("notifies each distinct post owner exactly once", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    foundPost.findUnique.mockResolvedValueOnce({ id: 2, userId: 2 });
    match.findUnique.mockResolvedValueOnce(null);
    txMatchCreate.mockResolvedValueOnce(matchRow());

    await createMatch(requester, { lostPostId: 1, foundPostId: 2 });

    expect(txNotificationCreate).toHaveBeenCalledTimes(2);
    expect(txNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 1, relatedId: 10 }) }),
    );
    expect(txNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 2, relatedId: 10 }) }),
    );
  });

  it("notifies only once when the same user owns both sides", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    foundPost.findUnique.mockResolvedValueOnce({ id: 2, userId: 1 });
    match.findUnique.mockResolvedValueOnce(null);
    txMatchCreate.mockResolvedValueOnce(matchRow());

    await createMatch(requester, { lostPostId: 1, foundPostId: 2 });

    expect(txNotificationCreate).toHaveBeenCalledTimes(1);
  });

  it("resolves a concurrent duplicate-insert race by returning the winning row", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    foundPost.findUnique.mockResolvedValueOnce({ id: 2, userId: 2 });
    match.findUnique.mockResolvedValueOnce(null); // no existing match seen at first
    $transaction.mockRejectedValueOnce(new FakePrismaClientKnownRequestError("P2002"));
    match.findUnique.mockResolvedValueOnce(matchRow({ id: 77 })); // the other request's winner

    const result = await createMatch(requester, { lostPostId: 1, foundPostId: 2 });

    expect(result).toEqual({ kind: "ok", data: expect.objectContaining({ id: 77 }) });
  });

  it("propagates a non-duplicate transaction failure instead of reporting a false success", async () => {
    // A genuine failure (not the P2002 race handled above) must not be
    // swallowed -- there is no Match row and no Notification row in this
    // case, and createMatch() must not claim otherwise. Atomicity itself
    // (no partial Match-without-Notification state) is Prisma's/the
    // underlying DB's guarantee for what happens *inside* $transaction's
    // callback; this only proves the wrapping code doesn't mask a failure
    // of the transaction as a whole.
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    foundPost.findUnique.mockResolvedValueOnce({ id: 2, userId: 2 });
    match.findUnique.mockResolvedValueOnce(null);
    $transaction.mockRejectedValueOnce(new Error("connection lost"));

    await expect(createMatch(requester, { lostPostId: 1, foundPostId: 2 })).rejects.toThrow(
      "connection lost",
    );
  });
});

describe("getMatch", () => {
  it("returns null for a nonexistent match", async () => {
    match.findUnique.mockResolvedValueOnce(null);
    expect(await getMatch(999)).toBeNull();
  });

  it("returns the match when found", async () => {
    match.findUnique.mockResolvedValueOnce(matchRow());
    const result = await getMatch(10);
    expect(result?.id).toBe(10);
  });
});

describe("listMatchesForPost", () => {
  it("rejects a viewer who doesn't own the post", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ userId: 999 });

    const result = await listMatchesForPost("lost", 1, 1);

    expect(result).toEqual({ kind: "forbidden", reason: "not_owner" });
  });

  it("returns matches for the post's owner", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ userId: 1 });
    match.findMany.mockResolvedValueOnce([matchRow()]);

    const result = await listMatchesForPost("lost", 1, 1);

    expect(result.kind).toBe("ok");
  });
});

describe("listMatchesForUser", () => {
  it("queries matches where the user owns either side", async () => {
    match.findMany.mockResolvedValueOnce([]);

    await listMatchesForUser(1);

    expect(match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ lostPost: { userId: 1 } }, { foundPost: { userId: 1 } }] },
      }),
    );
  });
});

describe("deleteMatch", () => {
  it("reports not_found for a nonexistent match", async () => {
    match.findUnique.mockResolvedValueOnce(null);
    expect(await deleteMatch(999, 1)).toEqual({ kind: "not_found" });
  });

  it("rejects a requester who owns neither side", async () => {
    match.findUnique.mockResolvedValueOnce(matchRow());

    const result = await deleteMatch(10, 999);

    expect(result).toEqual({ kind: "forbidden", reason: "not_owner" });
    expect(match.delete).not.toHaveBeenCalled();
  });

  it("allows the LostPost owner to cancel the match", async () => {
    match.findUnique.mockResolvedValueOnce(matchRow());

    const result = await deleteMatch(10, 1);

    expect(result).toEqual({ kind: "ok", data: { id: 10 } });
    expect(match.delete).toHaveBeenCalledWith({ where: { id: 10 } });
  });

  it("allows the FoundPost owner to cancel the match", async () => {
    match.findUnique.mockResolvedValueOnce(matchRow());

    const result = await deleteMatch(10, 2);

    expect(result.kind).toBe("ok");
  });
});

describe("getOwnedPostRefForMatch", () => {
  it("returns null for a nonexistent match", async () => {
    match.findUnique.mockResolvedValueOnce(null);

    expect(await getOwnedPostRefForMatch(999, 1)).toBeNull();
  });

  it("resolves to the LostPost side when the user owns it", async () => {
    match.findUnique.mockResolvedValueOnce(matchRow()); // lostPost.userId: 1, foundPost.userId: 2

    expect(await getOwnedPostRefForMatch(10, 1)).toEqual({ id: 1, type: "lost" });
  });

  it("resolves to the FoundPost side when the user owns it", async () => {
    match.findUnique.mockResolvedValueOnce(matchRow());

    expect(await getOwnedPostRefForMatch(10, 2)).toEqual({ id: 2, type: "found" });
  });

  it("returns null when the user owns neither side (stale/foreign notification)", async () => {
    match.findUnique.mockResolvedValueOnce(matchRow());

    expect(await getOwnedPostRefForMatch(10, 999)).toBeNull();
  });
});
