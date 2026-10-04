import { beforeEach, describe, expect, it, vi } from "vitest";

// 회원탈퇴: resolveSignIn() branches -- existing account, held withdrawn
// identity (no account created), approved rejoin (new account), and a plain
// new sign-up.
const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const userCreate = vi.fn();
const txUserCreate = vi.fn();
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ user: { create: txUserCreate } }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { user: { findUnique: userFindUnique, update: userUpdate, create: userCreate }, $transaction },
}));
vi.mock("@/lib/auth/access", () => ({ userTypeForEmail: vi.fn(async () => "STUDENT") }));
const findHeldIdentity = vi.fn();
const consumeApprovedRejoin = vi.fn();
vi.mock("@/lib/auth/withdrawnIdentity", () => ({ findHeldIdentity, consumeApprovedRejoin }));

const { resolveSignIn } = await import("./user");
const account = { email: "a@mju.ac.kr", name: "A", googleId: "g-1" };

beforeEach(() => vi.clearAllMocks());

describe("resolveSignIn", () => {
  it("an existing (active or deactivated) account keeps the old behaviour and never consults holds", async () => {
    userFindUnique.mockResolvedValue({ id: 5, deletedAt: new Date() });
    userUpdate.mockResolvedValueOnce({ id: 5, nickname: "n" });
    const r = await resolveSignIn(account);
    expect(r).toEqual({ kind: "user", user: { id: 5, nickname: "n" } });
    expect(userUpdate.mock.calls[0][0].data.deletedAt).toBeNull(); // reactivation unchanged
    expect(findHeldIdentity).not.toHaveBeenCalled();
  });

  it("a held identity with no approved request creates no account", async () => {
    userFindUnique.mockResolvedValue(null);
    findHeldIdentity.mockResolvedValueOnce({ id: 9, latestRequest: { id: 1, status: "REJECTED", consumedAt: null } });
    expect(await resolveSignIn(account)).toEqual({ kind: "held", identityId: 9 });
    expect(userCreate).not.toHaveBeenCalled();
    expect(txUserCreate).not.toHaveBeenCalled();
  });

  it("an approved, unused request creates a brand-new User (never the old one)", async () => {
    userFindUnique.mockResolvedValue(null);
    findHeldIdentity.mockResolvedValueOnce({ id: 9, latestRequest: { id: 1, status: "APPROVED", consumedAt: null } });
    consumeApprovedRejoin.mockResolvedValueOnce(true);
    txUserCreate.mockResolvedValueOnce({ id: 77, nickname: null });
    const r = await resolveSignIn(account);
    expect(r).toEqual({ kind: "user", user: { id: 77, nickname: null } });
    expect(consumeApprovedRejoin).toHaveBeenCalledWith(expect.anything(), 9, 1);
    expect(txUserCreate.mock.calls[0][0].data).toMatchObject({ email: account.email, googleId: account.googleId });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("stays held if the approval was already used by a concurrent sign-in", async () => {
    userFindUnique.mockResolvedValue(null);
    findHeldIdentity.mockResolvedValueOnce({ id: 9, latestRequest: { id: 1, status: "APPROVED", consumedAt: null } });
    consumeApprovedRejoin.mockResolvedValueOnce(false);
    expect(await resolveSignIn(account)).toEqual({ kind: "held", identityId: 9 });
    expect(txUserCreate).not.toHaveBeenCalled();
  });

  it("no hold: a normal new account (e.g. re-signup after a plain withdrawal)", async () => {
    userFindUnique.mockResolvedValue(null);
    findHeldIdentity.mockResolvedValueOnce(null);
    userCreate.mockResolvedValueOnce({ id: 80 });
    expect(await resolveSignIn(account)).toEqual({ kind: "user", user: { id: 80 } });
    expect(userCreate).toHaveBeenCalledTimes(1);
  });
});
