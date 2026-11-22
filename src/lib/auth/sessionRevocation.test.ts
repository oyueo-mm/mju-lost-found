import { describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { chatRealtimeSession: { findFirst } } }));
const { signedInBeforeCutoff, isSessionIdRevoked } = await import("./sessionRevocation");

describe("signedInBeforeCutoff (P-5)", () => {
  const cutoff = new Date(1_800_000_000_000);
  it("passes when there is no cut-off", () => {
    expect(signedInBeforeCutoff({ sessionsValidAfter: null }, { authTime: 0 })).toBe(false);
  });
  it("refuses a sign-in before the cut-off and accepts one at or after it", () => {
    expect(signedInBeforeCutoff({ sessionsValidAfter: cutoff }, { authTime: 1_799_999_999 })).toBe(true);
    expect(signedInBeforeCutoff({ sessionsValidAfter: cutoff }, { authTime: 1_800_000_000 })).toBe(false);
  });
  it("treats a missing or malformed authTime as signed in at 0", () => {
    expect(signedInBeforeCutoff({ sessionsValidAfter: cutoff }, {})).toBe(true);
    expect(signedInBeforeCutoff({ sessionsValidAfter: cutoff }, { authTime: Number.NaN })).toBe(true);
    expect(signedInBeforeCutoff({ sessionsValidAfter: cutoff }, null)).toBe(true);
  });
});

describe("isSessionIdRevoked (P-5)", () => {
  it("never queries for a missing or non-UUID session id", async () => {
    expect(await isSessionIdRevoked(1, undefined)).toBe(false);
    expect(await isSessionIdRevoked(1, "x' OR 1=1")).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
  it("is scoped to the same user", async () => {
    findFirst.mockResolvedValueOnce({ id: "a" });
    expect(await isSessionIdRevoked(7, "6f1c2c0e-3b7a-4c55-9a51-2a8d4b7e9f10")).toBe(true);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "6f1c2c0e-3b7a-4c55-9a51-2a8d4b7e9f10", userId: 7, revokedAt: { not: null } } }));
  });
});
