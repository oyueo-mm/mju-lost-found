import { describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const withdrawUser = vi.fn();
const signOut = vi.fn();

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/auth/user", () => ({ withdrawUser }));
vi.mock("@/lib/auth/auth", () => ({ signOut }));
// Same reason as src/app/api/me/privacy-consent/route.test.ts: avoid
// pulling in the real @/lib/posts/http.ts's next-auth import chain.
vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response };
});

const { POST } = await import("./route");

describe("POST /api/me/withdraw", () => {
  it("rejects an unauthenticated request", async () => {
    getCurrentUser.mockResolvedValueOnce(null);

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toMatch(/로그인/);
    expect(withdrawUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("withdraws the current user's own account -- id comes from the session, never the client", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 7 });
    withdrawUser.mockResolvedValueOnce({ id: 7, deletedAt: new Date() });
    signOut.mockResolvedValueOnce(undefined);

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(withdrawUser).toHaveBeenCalledWith(7);
    expect(json.data.withdrawn).toBe(true);
  });

  // Clears the session cookie in the same request rather than leaving a
  // still-"valid" JWT around for getCurrentUser() to reject on the next
  // request only -- see route.ts's own comment.
  it("clears the session (signOut) after a successful withdrawal", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 7 });
    withdrawUser.mockResolvedValueOnce({ id: 7, deletedAt: new Date() });
    signOut.mockResolvedValueOnce(undefined);

    await POST();

    expect(signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it("does not sign out when withdrawUser itself throws", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 7 });
    withdrawUser.mockRejectedValueOnce(new Error("db down"));

    const res = await POST();

    expect(res.status).toBe(500);
    expect(signOut).not.toHaveBeenCalled();
  });
});
