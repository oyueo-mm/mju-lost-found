import { beforeEach, describe, expect, it, vi } from "vitest";

const getOwnedPostRefForMatch = vi.fn();
const getMessage = vi.fn();
const getChatRoomForUser = vi.fn();

vi.mock("@/lib/match/service", () => ({ getOwnedPostRefForMatch }));
vi.mock("@/lib/chat/service", () => ({ getMessage, getChatRoomForUser }));

const { resolveHref } = await import("./resolveHref");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveHref -- match notifications", () => {
  it("links to the owned post for a match notification", async () => {
    getOwnedPostRefForMatch.mockResolvedValueOnce({ id: 5, type: "lost" });

    const href = await resolveHref(1, "match", 10);

    expect(href).toBe("/post/5?type=lost");
    expect(getOwnedPostRefForMatch).toHaveBeenCalledWith(10, 1);
  });

  it("returns null when the match no longer involves this user", async () => {
    getOwnedPostRefForMatch.mockResolvedValueOnce(null);
    expect(await resolveHref(1, "match", 10)).toBeNull();
  });
});

// Phase 11: message notifications -- relatedId is a Message id, resolved
// to its ChatRoom, with real access re-verified via getChatRoomForUser()
// (never trusted from the notification alone).
describe("resolveHref -- message notifications", () => {
  it("links to the chat room for a Direct-chat message notification", async () => {
    getMessage.mockResolvedValueOnce({ id: 100, chatRoomId: 200 });
    getChatRoomForUser.mockResolvedValueOnce({ kind: "ok", data: { id: 200, roomType: "direct" } });

    const href = await resolveHref(1, "message", 100);

    expect(href).toBe("/chat/200");
    expect(getMessage).toHaveBeenCalledWith(100);
    expect(getChatRoomForUser).toHaveBeenCalledWith(200, 1);
  });

  it("links to the chat room for a Match-chat message notification", async () => {
    getMessage.mockResolvedValueOnce({ id: 101, chatRoomId: 300 });
    getChatRoomForUser.mockResolvedValueOnce({ kind: "ok", data: { id: 300, roomType: "match" } });

    const href = await resolveHref(1, "message", 101);

    expect(href).toBe("/chat/300");
  });

  it("returns null (safe fallback) when the message no longer exists", async () => {
    getMessage.mockResolvedValueOnce(null);

    const href = await resolveHref(1, "message", 999);

    expect(href).toBeNull();
    expect(getChatRoomForUser).not.toHaveBeenCalled();
  });

  // Security-critical: this is what actually prevents a client from
  // reaching another user's room via a tampered/stale relatedId -- the
  // same getChatRoomForUser() authorization every other chat entry point
  // uses, re-run here regardless of what the notification claims.
  it("returns null when the current user isn't actually a participant of that room", async () => {
    getMessage.mockResolvedValueOnce({ id: 102, chatRoomId: 400 });
    getChatRoomForUser.mockResolvedValueOnce({ kind: "forbidden" });

    const href = await resolveHref(999, "message", 102);

    expect(href).toBeNull();
  });

  it("returns null when the room itself no longer exists", async () => {
    getMessage.mockResolvedValueOnce({ id: 103, chatRoomId: 500 });
    getChatRoomForUser.mockResolvedValueOnce({ kind: "not_found" });

    expect(await resolveHref(1, "message", 103)).toBeNull();
  });
});

describe("resolveHref -- other cases", () => {
  it("returns null for a null relatedId regardless of type", async () => {
    expect(await resolveHref(1, "match", null)).toBeNull();
    expect(await resolveHref(1, "message", null)).toBeNull();
    expect(getOwnedPostRefForMatch).not.toHaveBeenCalled();
    expect(getMessage).not.toHaveBeenCalled();
  });

  it("returns null for a relatedType this app has no link for (e.g. report_processed)", async () => {
    expect(await resolveHref(1, "report_processed", 10)).toBeNull();
  });

  it("returns null for a null relatedType", async () => {
    expect(await resolveHref(1, null, 10)).toBeNull();
  });
});
