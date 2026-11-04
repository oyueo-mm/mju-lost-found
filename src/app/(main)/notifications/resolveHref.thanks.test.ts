import { beforeEach, describe, expect, it, vi } from "vitest";

const thankNote = { findUnique: vi.fn() };
vi.mock("@/lib/db/prisma", () => ({ prisma: { thankNote } }));
vi.mock("@/lib/chat/service", () => ({ getChatRoomForUser: vi.fn(), getMessage: vi.fn() }));
vi.mock("@/lib/comment/service", () => ({ getCommentPostRef: vi.fn() }));
vi.mock("@/lib/report/service", () => ({ getReportTargetRef: vi.fn() }));
vi.mock("@/lib/report/targets", () => ({ encodePostTargetId: vi.fn(), resolveMessageTarget: vi.fn(), resolvePostTarget: vi.fn() }));
vi.mock("@/lib/announcement/service", () => ({ getAnnouncement: vi.fn() }));
vi.mock("@/lib/organization/service", () => ({ getOrganizationById: vi.fn() }));
vi.mock("@/lib/keywordAlert/service", () => ({ getKeywordAlertMatchForUser: vi.fn() }));

const { resolveHref } = await import("./resolveHref");
const thanks = (userId: number) => resolveHref(userId, "thank_note", "thank_note", 1);

beforeEach(() => vi.clearAllMocks());

// Phase 3-B: a received 감사 후기 opens the chat room where it was written.
describe("감사 후기 알림 링크", () => {
  it("opens the note's chat room for its receiver", async () => {
    thankNote.findUnique.mockResolvedValue({ receiverUserId: 20, hiddenAt: null, adminHiddenAt: null, chatRoomId: 7 });
    expect(await thanks(20)).toBe("/chat/7");
  });

  it("falls back to /me/thanks for a note without a room", async () => {
    thankNote.findUnique.mockResolvedValue({ receiverUserId: 20, hiddenAt: null, adminHiddenAt: null, chatRoomId: null });
    expect(await thanks(20)).toBe("/me/thanks");
  });

  it("links nowhere for anyone else, or once hidden by the receiver or an admin", async () => {
    thankNote.findUnique.mockResolvedValue({ receiverUserId: 20, hiddenAt: null, adminHiddenAt: null, chatRoomId: 7 });
    expect(await thanks(10)).toBeNull();
    thankNote.findUnique.mockResolvedValue({ receiverUserId: 20, hiddenAt: new Date(), adminHiddenAt: null, chatRoomId: 7 });
    expect(await thanks(20)).toBeNull();
    thankNote.findUnique.mockResolvedValue({ receiverUserId: 20, hiddenAt: null, adminHiddenAt: new Date(), chatRoomId: 7 });
    expect(await thanks(20)).toBeNull();
  });
});

describe("약관·방침 변경 안내 링크", () => {
  it("opens the changes page for anyone who got the notice", async () => {
    expect(await resolveHref(5, "announcement", "policy_revision", 20261105)).toBe("/policy/changes");
  });
});
