import { describe, expect, it, vi } from "vitest";

const upsert = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: { user: { upsert } },
}));

const { resolveOrCreateUser } = await import("./user");

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
