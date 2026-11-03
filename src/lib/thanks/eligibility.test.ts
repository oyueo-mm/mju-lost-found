import { describe, expect, it } from "vitest";
import { looksPersonal, thankTarget, validateThankBody, type ThankContext } from "./eligibility";

// a return recorded from room 7: owner 10 (got it back), finder 20
const ret = { id: 3, chatRoomId: 7, ownerUserId: 10, finderUserId: 20, revoked: false };
const ctx = (over: Partial<ThankContext> = {}): ThankContext => ({ completed: true, ret, writers: [10, 20], unavailable: new Set(), alreadySent: false, ...over });

describe("감사 쪽지: thankTarget (who may thank whom)", () => {
  it("the owner of the recorded return thanks its finder, through that room", () => {
    expect(thankTarget(10, ctx())).toEqual({ receiverId: 20, chatRoomId: 7, returnId: 3 });
  });

  it("the finder, a third person or the completer-who-is-the-finder cannot", () => {
    expect(thankTarget(20, ctx())).toBeNull();
    expect(thankTarget(30, ctx())).toBeNull();
  });

  it("no return recorded (completed from the post page) gives nobody the right", () => {
    expect(thankTarget(10, ctx({ ret: null }))).toBeNull();
  });

  it("an undone completion or a revoked return gives nothing", () => {
    expect(thankTarget(10, ctx({ completed: false }))).toBeNull();
    expect(thankTarget(10, ctx({ ret: { ...ret, revoked: true } }))).toBeNull();
    expect(thankTarget(10, ctx({ ret: { ...ret, chatRoomId: null } }))).toBeNull();
  });

  it("both people must have written in the linked room", () => {
    expect(thankTarget(10, ctx({ writers: [20] }))).toBeNull();
    expect(thankTarget(10, ctx({ writers: [10] }))).toBeNull();
  });

  it("once per post; not to or from a suspended / withdrawn account; never oneself", () => {
    expect(thankTarget(10, ctx({ alreadySent: true }))).toBeNull();
    expect(thankTarget(10, ctx({ unavailable: new Set([20]) }))).toBeNull();
    expect(thankTarget(10, ctx({ unavailable: new Set([10]) }))).toBeNull();
    expect(thankTarget(10, ctx({ ret: { ...ret, finderUserId: 10 } }))).toBeNull();
  });
});

describe("validateThankBody", () => {
  it("trims, rejects empty and over-long notes (code points, like the DB check)", () => {
    expect(validateThankBody("  고마워요  ")).toEqual({ ok: true, body: "고마워요" });
    expect(validateThankBody("   ")).toEqual({ ok: false, error: "empty" });
    expect(validateThankBody(undefined)).toEqual({ ok: false, error: "empty" });
    expect(validateThankBody("가".repeat(500)).ok).toBe(true);
    expect(validateThankBody("가".repeat(501))).toEqual({ ok: false, error: "too_long" });
    expect(validateThankBody("😀".repeat(500)).ok).toBe(true);
  });
});

describe("looksPersonal (publishing guard)", () => {
  it("flags phone numbers, e-mail, long digit runs, 주민번호-like and messenger IDs", () => {
    for (const t of ["010-1234-5678", "01012345678", "02-123-4567", "a.b@mju.ac.kr", "학번 60201234", "900101-1234567", "카톡 아이디: mju_find", "insta: mju.find"]) expect(looksPersonal(`고마워요 ${t}`), t).toBe(true);
  });
  it("lets ordinary thanks through", () => {
    for (const t of ["지갑 찾아주셔서 정말 감사합니다!", "11월 3일에 받았어요, 3층 경비실 덕분이에요", "커피 한 잔 사드리고 싶어요 :)"]) expect(looksPersonal(t), t).toBe(false);
  });
});
