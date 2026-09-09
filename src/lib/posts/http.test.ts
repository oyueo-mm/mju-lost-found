import { describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));

const { requireUserForApi } = await import("./http");

async function statusOf(result: Awaited<ReturnType<typeof requireUserForApi>>): Promise<number | null> {
  if (!("response" in result)) return null;
  return result.response.status;
}

async function errorOf(result: Awaited<ReturnType<typeof requireUserForApi>>): Promise<string | undefined> {
  if (!("response" in result)) return undefined;
  const json = await result.response.json();
  return json.error;
}

describe("requireUserForApi", () => {
  it("rejects an unauthenticated request", async () => {
    getCurrentUser.mockResolvedValueOnce(null);

    const result = await requireUserForApi();

    expect(await statusOf(result)).toBe(401);
  });

  // Phase 8: checked before the nickname check -- an existing user (with
  // a nickname already set) who hasn't agreed to the privacy notice yet
  // must still be rejected, not let through on account of their nickname.
  it("rejects a logged-in user who hasn't agreed to the privacy notice yet, even with a nickname set", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 1, nickname: "닉네임", privacyConsentAt: null });

    const result = await requireUserForApi();

    expect(await statusOf(result)).toBe(403);
    expect(await errorOf(result)).toMatch(/동의/);
  });

  it("rejects a consented user who hasn't set a nickname yet", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 1, nickname: null, privacyConsentAt: new Date() });

    const result = await requireUserForApi();

    expect(await statusOf(result)).toBe(403);
    expect(await errorOf(result)).toMatch(/닉네임/);
  });

  it("returns the user when consented and ready", async () => {
    const user = { id: 1, nickname: "닉네임", privacyConsentAt: new Date() };
    getCurrentUser.mockResolvedValueOnce(user);

    const result = await requireUserForApi();

    expect(result).toEqual({ user });
  });
});
