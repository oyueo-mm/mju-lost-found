import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/generated/prisma/client";

const suspensionAppeal = {
  create: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  count: vi.fn(),
  update: vi.fn(),
};
// Phase 12-9 §2: submitSuspensionAppeal() now wraps its insert in
// $transaction and calls fanOutToAdmins() -- see report/service.test.ts's
// own identical-shape comment for why both are mocked this way.
const fanOutToAdmins = vi.fn();
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ suspensionAppeal }));

vi.mock("@/lib/db/prisma", () => ({ prisma: { suspensionAppeal, $transaction } }));
vi.mock("@/lib/notification/adminFanout", () => ({ fanOutToAdmins }));
vi.mock("@/lib/auth/suspension", () => ({
  isCurrentlySuspended: (user: { isSuspended?: boolean }) => Boolean(user?.isSuspended),
}));
vi.mock("./service", () => ({ isAdmin: (u: { isAdmin: boolean }) => u.isAdmin }));
vi.mock("@/generated/prisma/client", () => ({
  NotificationType: { SUSPENSION_APPEAL_RECEIVED: "SUSPENSION_APPEAL_RECEIVED" },
}));

const {
  submitSuspensionAppeal,
  getLatestAppealForUser,
  listSuspensionAppealsForAdmin,
  markSuspensionAppealReviewed,
} = await import("./appeals");

const suspendedUser = { id: 1, nickname: "정지됨", isSuspended: true, suspendedUntil: null } as unknown as User;
const activeUser = { id: 2, nickname: "정상", isSuspended: false, suspendedUntil: null } as unknown as User;
const admin = { id: 9, isAdmin: true };
const nonAdmin = { id: 10, isAdmin: false };

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 100,
  content: "정지가 부당하다고 생각합니다.",
  createdAt: new Date("2026-01-01"),
  reviewedAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("submitSuspensionAppeal", () => {
  it("rejects a non-suspended user -- nothing to appeal", async () => {
    const result = await submitSuspensionAppeal(activeUser, "이의 있습니다");
    expect(result).toEqual({ kind: "not_suspended" });
    expect(suspensionAppeal.create).not.toHaveBeenCalled();
  });

  it("rejects blank content", async () => {
    const result = await submitSuspensionAppeal(suspendedUser, "   ");
    expect(result).toEqual({ kind: "blank_content" });
    expect(suspensionAppeal.create).not.toHaveBeenCalled();
  });

  it("rejects a second appeal while an earlier one is still unreviewed", async () => {
    suspensionAppeal.findFirst.mockResolvedValueOnce({ id: 1 });
    const result = await submitSuspensionAppeal(suspendedUser, "또 이의 있습니다");
    expect(result).toEqual({ kind: "already_pending" });
    expect(suspensionAppeal.create).not.toHaveBeenCalled();
  });

  it("creates the appeal for the caller's own account", async () => {
    suspensionAppeal.findFirst.mockResolvedValueOnce(null);
    suspensionAppeal.create.mockResolvedValueOnce(row());

    const result = await submitSuspensionAppeal(suspendedUser, "  이의 있습니다  ");

    expect(result).toEqual({ kind: "ok", data: expect.objectContaining({ id: 100 }) });
    expect(suspensionAppeal.create).toHaveBeenCalledWith({
      data: { userId: suspendedUser.id, content: "이의 있습니다" },
    });
  });

  // Phase 12-9 §2: every successful appeal fans out to admins.
  it("fans out a SUSPENSION_APPEAL_RECEIVED notification to admins on successful creation", async () => {
    suspensionAppeal.findFirst.mockResolvedValueOnce(null);
    suspensionAppeal.create.mockResolvedValueOnce(row({ id: 101 }));

    await submitSuspensionAppeal(suspendedUser, "이의 있습니다");

    expect(fanOutToAdmins).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "SUSPENSION_APPEAL_RECEIVED", relatedType: "suspension_appeal", relatedId: 101 }),
    );
  });

  it("does not fan out to admins when the pre-check already rejected", async () => {
    const result = await submitSuspensionAppeal(activeUser, "이의 있습니다");
    expect(result).toEqual({ kind: "not_suspended" });
    expect(fanOutToAdmins).not.toHaveBeenCalled();
  });
});

describe("getLatestAppealForUser", () => {
  it("returns the most recent appeal for that user", async () => {
    suspensionAppeal.findFirst.mockResolvedValueOnce(row());
    const result = await getLatestAppealForUser(1);
    expect(result).toEqual(expect.objectContaining({ id: 100 }));
    expect(suspensionAppeal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1 } }),
    );
  });

  it("returns null when the user has never filed one", async () => {
    suspensionAppeal.findFirst.mockResolvedValueOnce(null);
    expect(await getLatestAppealForUser(1)).toBeNull();
  });
});

describe("listSuspensionAppealsForAdmin", () => {
  it("rejects a non-admin", async () => {
    const result = await listSuspensionAppealsForAdmin(nonAdmin as never, { page: 1, limit: 20 });
    expect(result).toEqual({ kind: "forbidden" });
    expect(suspensionAppeal.findMany).not.toHaveBeenCalled();
  });

  it("returns a paged list for an admin", async () => {
    suspensionAppeal.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    suspensionAppeal.count.mockResolvedValueOnce(0);

    const result = await listSuspensionAppealsForAdmin(admin as never, { page: 1, limit: 20 });

    expect(result).toEqual({
      kind: "ok",
      data: { items: [], page: 1, limit: 20, total: 0, totalPages: 1 },
    });
  });
});

describe("markSuspensionAppealReviewed", () => {
  it("rejects a non-admin", async () => {
    const result = await markSuspensionAppealReviewed(nonAdmin as never, 100);
    expect(result).toEqual({ kind: "forbidden" });
    expect(suspensionAppeal.update).not.toHaveBeenCalled();
  });

  it("returns not_found for a nonexistent appeal", async () => {
    suspensionAppeal.findUnique.mockResolvedValueOnce(null);
    expect(await markSuspensionAppealReviewed(admin as never, 999)).toEqual({ kind: "not_found" });
  });

  it("marks the appeal reviewed by the calling admin", async () => {
    suspensionAppeal.findUnique.mockResolvedValueOnce(row());
    suspensionAppeal.update.mockResolvedValueOnce(row({ reviewedAt: new Date("2026-02-01") }));

    const result = await markSuspensionAppealReviewed(admin as never, 100);

    expect(result.kind).toBe("ok");
    expect(suspensionAppeal.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { reviewedAt: expect.any(Date), reviewedByUserId: admin.id },
    });
  });
});
