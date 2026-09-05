import { describe, expect, it } from "vitest";

import { isCurrentlySuspended } from "./suspension";

describe("isCurrentlySuspended", () => {
  it("is false for a user who was never suspended", () => {
    expect(isCurrentlySuspended({ isSuspended: false, suspendedUntil: null })).toBe(false);
  });

  it("is true for a permanent suspension (isSuspended, no suspendedUntil)", () => {
    expect(isCurrentlySuspended({ isSuspended: true, suspendedUntil: null })).toBe(true);
  });

  it("is true for a timed suspension that hasn't expired yet", () => {
    const future = new Date(Date.now() + 60_000);
    expect(isCurrentlySuspended({ isSuspended: true, suspendedUntil: future })).toBe(true);
  });

  it("is false for a timed suspension whose end time has already passed", () => {
    const past = new Date(Date.now() - 60_000);
    expect(isCurrentlySuspended({ isSuspended: true, suspendedUntil: past })).toBe(false);
  });

  it("ignores a stale suspendedUntil once isSuspended itself is false", () => {
    // Mirrors the legacy is_user_suspended(): an expired/cleared suspension
    // is read-time only -- isSuspended is the real gate, suspendedUntil on
    // its own never suspends anyone.
    const future = new Date(Date.now() + 60_000);
    expect(isCurrentlySuspended({ isSuspended: false, suspendedUntil: future })).toBe(false);
  });
});
