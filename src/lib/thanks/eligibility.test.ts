import { describe, expect, it } from "vitest";
import { thankCandidates, validateThankBody, type ThankRoom } from "./eligibility";

// people: 10 = lost-post author (owner) / found-post author (finder), 20 / 30 = others
const room = (id: number, initiator: number, counterpart: number, writers: number[], organizationId: number | null = null): ThankRoom => ({
  id,
  initiatorUserId: initiator,
  counterpartUserId: counterpart,
  organizationId,
  writers,
});
const lost = { type: "lost" as const, authorId: 10, completed: true };
const found = { type: "found" as const, authorId: 10, completed: true };

describe("감사 쪽지: who may thank whom", () => {
  it("분실물: the author (who got it back) thanks the finder they chatted with", () => {
    expect(thankCandidates(lost, 10, [room(1, 20, 10, [10, 20])])).toEqual([{ receiverId: 20, chatRoomId: 1 }]);
    // the finder cannot thank themselves into the owner's place
    expect(thankCandidates(lost, 20, [room(1, 20, 10, [10, 20])])).toEqual([]);
  });

  it("습득물: the owner who contacted the finder thanks the author; the author cannot", () => {
    expect(thankCandidates(found, 20, [room(1, 20, 10, [10, 20])])).toEqual([{ receiverId: 10, chatRoomId: 1 }]);
    expect(thankCandidates(found, 10, [room(1, 20, 10, [10, 20])])).toEqual([]);
  });

  it("needs the post marked done", () => {
    expect(thankCandidates({ ...lost, completed: false }, 10, [room(1, 20, 10, [10, 20])])).toEqual([]);
  });

  it("needs both people to have written in the room (no note from an unanswered chat)", () => {
    expect(thankCandidates(lost, 10, [room(1, 20, 10, [20])])).toEqual([]);
    expect(thankCandidates(lost, 10, [room(1, 20, 10, [10])])).toEqual([]);
    expect(thankCandidates(lost, 10, [room(1, 20, 10, [])])).toEqual([]);
  });

  it("an outsider with no room, an organization room and a broken room give nothing", () => {
    expect(thankCandidates(found, 30, [room(1, 20, 10, [10, 20])])).toEqual([]);
    expect(thankCandidates(lost, 10, [room(1, 20, 10, [10, 20], 7)])).toEqual([]);
    expect(thankCandidates(lost, 10, [{ id: 2, initiatorUserId: 20, counterpartUserId: null, organizationId: 7, writers: [10, 20] }])).toEqual([]);
  });

  it("never oneself, even in a malformed self-room", () => {
    expect(thankCandidates(lost, 10, [room(1, 10, 10, [10])])).toEqual([]);
  });

  it("once per post, and not to or from a suspended / withdrawn account", () => {
    const rooms = [room(1, 20, 10, [10, 20])];
    expect(thankCandidates(lost, 10, rooms, { alreadySent: true })).toEqual([]);
    expect(thankCandidates(lost, 10, rooms, { unavailable: new Set([20]) })).toEqual([]);
    expect(thankCandidates(lost, 10, rooms, { unavailable: new Set([10]) })).toEqual([]);
  });

  it("several finders who chatted: each is a choice, once", () => {
    const rooms = [room(1, 20, 10, [10, 20]), room(2, 30, 10, [10, 30]), room(3, 20, 10, [10, 20])];
    expect(thankCandidates(lost, 10, rooms)).toEqual([
      { receiverId: 20, chatRoomId: 1 },
      { receiverId: 30, chatRoomId: 2 },
    ]);
  });
});

describe("validateThankBody", () => {
  it("trims, rejects empty and over-long notes (code points, like the DB check)", () => {
    expect(validateThankBody("  고마워요  ")).toEqual({ ok: true, body: "고마워요" });
    expect(validateThankBody("   ").ok).toBe(false);
    expect(validateThankBody(undefined).ok).toBe(false);
    expect(validateThankBody("가".repeat(500)).ok).toBe(true);
    expect(validateThankBody("가".repeat(501)).ok).toBe(false);
    expect(validateThankBody("😀".repeat(500)).ok).toBe(true);
  });
});
