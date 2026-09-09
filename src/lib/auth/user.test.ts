import { describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const updateMany = vi.fn();
const findUniqueOrThrow = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: { user: { upsert, updateMany, findUniqueOrThrow } },
}));

const { resolveOrCreateUser, recordPrivacyConsent } = await import("./user");

describe("resolveOrCreateUser", () => {
  it("looks up an existing user by email (login) -- get-or-create, not duplicate-create", async () => {
    upsert.mockResolvedValueOnce({
      id: 1,
      email: "existing@mju.ac.kr",
      nickname: "기존닉네임",
    });

    const user = await resolveOrCreateUser({
      email: "existing@mju.ac.kr",
      name: "Existing User",
      googleId: "google-sub-1",
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "existing@mju.ac.kr" } }),
    );
    // The existing row (with its already-set nickname) is what's returned,
    // not a fresh one -- upsert's `update` branch, never `create`, runs
    // for a row that already exists.
    expect(user).toEqual({ id: 1, email: "existing@mju.ac.kr", nickname: "기존닉네임" });
  });

  it("creates a new user with a name fallback when Google reports no name", async () => {
    upsert.mockResolvedValueOnce({ id: 2, email: "new@mju.ac.kr", nickname: null });

    await resolveOrCreateUser({ email: "new@mju.ac.kr", name: null, googleId: "google-sub-2" });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          email: "new@mju.ac.kr",
          name: "new", // falls back to the local part of the email
          googleId: "google-sub-2",
        }),
      }),
    );
  });

  it("records googleId on the update branch too, for a user re-linking/re-logging in", async () => {
    upsert.mockResolvedValueOnce({ id: 1, email: "existing@mju.ac.kr", nickname: null });

    await resolveOrCreateUser({
      email: "existing@mju.ac.kr",
      name: "Existing User",
      googleId: "google-sub-1",
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ googleId: "google-sub-1" }),
      }),
    );
  });

  // Phase P-1: this function is only ever called from the jwt callback's
  // `account`-present branch (a real sign-in exchange), so stamping
  // lastLoginAt here is a true "last login", not "session still valid".
  it("stamps lastLoginAt on both the create and update branches", async () => {
    upsert.mockResolvedValueOnce({ id: 1, email: "existing@mju.ac.kr" });

    await resolveOrCreateUser({
      email: "existing@mju.ac.kr",
      name: "Existing User",
      googleId: "google-sub-1",
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        create: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
      }),
    );
  });
});

describe("recordPrivacyConsent", () => {
  it("stamps privacyConsentAt with the server's own clock, only while it's still unset", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUniqueOrThrow.mockResolvedValueOnce({ id: 5, privacyConsentAt: new Date() });

    await recordPrivacyConsent(5);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 5, privacyConsentAt: null },
      data: { privacyConsentAt: expect.any(Date) },
    });
  });

  it("returns the fresh user row after recording consent", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUniqueOrThrow.mockResolvedValueOnce({ id: 5, privacyConsentAt: new Date("2026-01-01T00:00:00Z") });

    const user = await recordPrivacyConsent(5);

    expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(user).toEqual({ id: 5, privacyConsentAt: new Date("2026-01-01T00:00:00Z") });
  });

  // Idempotent: a second call (double-submit, or hitting the API directly
  // after already consenting) must not overwrite the original consent
  // instant -- the where-clause's `privacyConsentAt: null` guard makes
  // updateMany match zero rows in that case, same "only if still unset"
  // pattern as onboarding/actions.ts's nickname write.
  it("does not overwrite an already-recorded consent timestamp", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    const original = new Date("2025-06-01T00:00:00Z");
    findUniqueOrThrow.mockResolvedValueOnce({ id: 5, privacyConsentAt: original });

    const user = await recordPrivacyConsent(5);

    expect(user.privacyConsentAt).toEqual(original);
  });
});
