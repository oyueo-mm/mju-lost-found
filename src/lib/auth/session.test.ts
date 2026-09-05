import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const findUnique = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/lib/auth/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { findUnique } } }));
vi.mock("next/navigation", () => ({ redirect }));

const { getCurrentUser, requireUser, requireReadyUser, requireActiveUser, requireAdmin, sanitizeCallbackUrl } =
  await import("./session");

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

  // Phase 14: reason/callbackUrl are UX-only additions to the same
  // redirect -- omitting them (every test above) must keep working
  // exactly as before.
  it("includes reason and callbackUrl in the /login redirect when given", async () => {
    auth.mockResolvedValueOnce(null);

    await expect(requireUser("chat", "/chat")).rejects.toThrow(
      "REDIRECT:/login?reason=chat&callbackUrl=%2Fchat",
    );
  });

  it("includes only reason when callbackUrl is omitted", async () => {
    auth.mockResolvedValueOnce(null);

    await expect(requireUser("write")).rejects.toThrow("REDIRECT:/login?reason=write");
  });
});

describe("requireReadyUser", () => {
  it("returns the user when nickname is already set", async () => {
    auth.mockResolvedValueOnce({ user: { id: "1" } });
    findUnique.mockResolvedValueOnce({ id: 1, nickname: "닉네임" });

    await expect(requireReadyUser()).resolves.toEqual({ id: 1, nickname: "닉네임" });
  });

  it("redirects to /onboarding when signed in but nickname is not set yet", async () => {
    auth.mockResolvedValueOnce({ user: { id: "1" } });
    findUnique.mockResolvedValueOnce({ id: 1, nickname: null });

    await expect(requireReadyUser()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("redirects to /login when not signed in (delegates to requireUser)", async () => {
    auth.mockResolvedValueOnce(null);

    await expect(requireReadyUser()).rejects.toThrow("REDIRECT:/login");
  });

  it("forwards reason/callbackUrl to /login when not signed in", async () => {
    auth.mockResolvedValueOnce(null);

    await expect(requireReadyUser("mypost", "/posts/mine")).rejects.toThrow(
      "REDIRECT:/login?reason=mypost&callbackUrl=%2Fposts%2Fmine",
    );
  });
});

describe("sanitizeCallbackUrl", () => {
  it("accepts a plain relative path", () => {
    expect(sanitizeCallbackUrl("/chat/5")).toBe("/chat/5");
  });

  it("accepts a relative path with a query string", () => {
    expect(sanitizeCallbackUrl("/post/6/edit?type=lost")).toBe("/post/6/edit?type=lost");
  });

  it("returns undefined for undefined/null/empty input", () => {
    expect(sanitizeCallbackUrl(undefined)).toBeUndefined();
    expect(sanitizeCallbackUrl(null)).toBeUndefined();
    expect(sanitizeCallbackUrl("")).toBeUndefined();
  });

  // Open-redirect guards: a `callbackUrl` crosses a client-visible URL
  // (see /post/[id]'s login-prompt link, or a hand-crafted request to
  // /login), so it's untrusted regardless of who normally sets it.
  it("rejects a protocol-relative URL (resolves to an external host)", () => {
    expect(sanitizeCallbackUrl("//evil.com")).toBeUndefined();
  });

  it("rejects an absolute external URL", () => {
    expect(sanitizeCallbackUrl("https://evil.com/phish")).toBeUndefined();
  });

  it("rejects a value that embeds a scheme anywhere in the string", () => {
    expect(sanitizeCallbackUrl("/redirect?to=https://evil.com")).toBeUndefined();
  });

  it("rejects a path that doesn't start with a slash", () => {
    expect(sanitizeCallbackUrl("chat/5")).toBeUndefined();
  });
});

describe("requireActiveUser", () => {
  it("returns the user when ready and not suspended", async () => {
    auth.mockResolvedValueOnce({ user: { id: "1" } });
    findUnique.mockResolvedValueOnce({
      id: 1,
      nickname: "닉네임",
      isSuspended: false,
      suspendedUntil: null,
    });

    await expect(requireActiveUser()).resolves.toMatchObject({ id: 1 });
  });

  it("redirects to /suspended for a permanently suspended user", async () => {
    auth.mockResolvedValueOnce({ user: { id: "1" } });
    findUnique.mockResolvedValueOnce({
      id: 1,
      nickname: "닉네임",
      isSuspended: true,
      suspendedUntil: null,
    });

    await expect(requireActiveUser()).rejects.toThrow("REDIRECT:/suspended");
  });

  it("redirects to /suspended for a timed suspension that hasn't expired yet", async () => {
    auth.mockResolvedValueOnce({ user: { id: "1" } });
    findUnique.mockResolvedValueOnce({
      id: 1,
      nickname: "닉네임",
      isSuspended: true,
      suspendedUntil: new Date(Date.now() + 60_000),
    });

    await expect(requireActiveUser()).rejects.toThrow("REDIRECT:/suspended");
  });

  it("allows a user through once their timed suspension has expired", async () => {
    auth.mockResolvedValueOnce({ user: { id: "1" } });
    findUnique.mockResolvedValueOnce({
      id: 1,
      nickname: "닉네임",
      isSuspended: true,
      suspendedUntil: new Date(Date.now() - 60_000),
    });

    await expect(requireActiveUser()).resolves.toMatchObject({ id: 1 });
  });

  it("redirects to /onboarding before checking suspension when nickname isn't set", async () => {
    auth.mockResolvedValueOnce({ user: { id: "1" } });
    findUnique.mockResolvedValueOnce({
      id: 1,
      nickname: null,
      isSuspended: true,
      suspendedUntil: null,
    });

    await expect(requireActiveUser()).rejects.toThrow("REDIRECT:/onboarding");
  });
});

describe("requireAdmin", () => {
  it("returns the user when ready and an admin", async () => {
    auth.mockResolvedValueOnce({ user: { id: "1" } });
    findUnique.mockResolvedValueOnce({ id: 1, nickname: "닉네임", isAdmin: true });

    await expect(requireAdmin()).resolves.toMatchObject({ id: 1, isAdmin: true });
  });

  it("redirects to / when ready but not an admin -- never trusts a client claim", async () => {
    auth.mockResolvedValueOnce({ user: { id: "1" } });
    findUnique.mockResolvedValueOnce({ id: 1, nickname: "닉네임", isAdmin: false });

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/");
  });

  it("redirects to /onboarding before checking admin status when nickname isn't set", async () => {
    auth.mockResolvedValueOnce({ user: { id: "1" } });
    findUnique.mockResolvedValueOnce({ id: 1, nickname: null, isAdmin: true });

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/onboarding");
  });
});
