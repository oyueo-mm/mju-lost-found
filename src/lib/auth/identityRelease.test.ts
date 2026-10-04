import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const requestDeleteMany = vi.fn((args: unknown) => ({ op: "requests", args }));
const identityDeleteMany = vi.fn((args: unknown) => ({ op: "identity", args }));
const $transaction = vi.fn(async (ops: unknown[]) => ops);
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    withdrawnIdentity: { findMany, deleteMany: identityDeleteMany },
    rejoinRequest: { deleteMany: requestDeleteMany },
    $transaction,
  },
}));
const openHoldReasons = vi.fn();
vi.mock("@/lib/auth/holdState", () => ({ openHoldReasons }));

const { releaseResolvedWithdrawnIdentities } = await import("./identityRelease");
const user = { id: 5, isSuspended: false, suspendedUntil: null };

beforeEach(() => vi.clearAllMocks());

describe("releaseResolvedWithdrawnIdentities", () => {
  it("keeps a hold while any open matter remains", async () => {
    findMany.mockResolvedValueOnce([{ id: 1, withdrawnUser: user }]);
    openHoldReasons.mockResolvedValueOnce(["active_suspension"]);
    expect(await releaseResolvedWithdrawnIdentities()).toEqual([]);
    expect($transaction).not.toHaveBeenCalled();
  });

  it("deletes the hold as soon as nothing is open, with its still-pending request (decided ones keep their record)", async () => {
    findMany.mockResolvedValueOnce([{ id: 1, withdrawnUser: user }]);
    openHoldReasons.mockResolvedValueOnce([]);
    expect(await releaseResolvedWithdrawnIdentities()).toEqual([1]);
    expect(requestDeleteMany).toHaveBeenCalledWith({ where: { identityId: 1, status: "PENDING" } });
    expect(identityDeleteMany).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it("can be limited to specific holds (sign-in check)", async () => {
    findMany.mockResolvedValueOnce([]);
    await releaseResolvedWithdrawnIdentities([7]);
    expect(findMany.mock.calls[0][0].where).toEqual({ id: { in: [7] } });
  });
});
