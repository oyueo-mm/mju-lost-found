import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const findUnique = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/lib/auth/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { findUnique } } }));
vi.mock("next/navigation", () => ({ redirect }));

const { getCurrentUser, requireUser } = await import("./session");

beforeEach(() => {
  auth.mockReset();
  findUnique.mockReset();
  redirect.mockClear();
});

describe("getCurrentUser", () => {
  it("returns null without touching the DB when there is no session", async () => {
    auth.mockResolvedValueOnce(null);

    const user = await getCurrentUser();

    expect(user).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("re-reads the User row from the DB using the session's id -- never trusts cached session fields", async () => {
    auth.mockResolvedValueOnce({ user: { id: "42", nickname: "stale-cached-value" } });
    findUnique.mockResolvedValueOnce({ id: 42, nickname: "실제닉네임", isAdmin: false });

    const user = await getCurrentUser();

    expect(findUnique).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(user).toEqual({ id: 42, nickname: "실제닉네임", isAdmin: false });
  });
});

describe("requireUser", () => {
  it("returns the user when signed in", async () => {
    auth.mockResolvedValueOnce({ user: { id: "1", nickname: null } });
    findUnique.mockResolvedValueOnce({ id: 1, nickname: null });

    await expect(requireUser()).resolves.toEqual({ id: 1, nickname: null });
  });

  it("redirects to /login when not signed in, for a protected page like /onboarding", async () => {
    auth.mockResolvedValueOnce(null);

    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
  });
});
