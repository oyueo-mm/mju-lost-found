import { describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const withdrawUser = vi.fn();
const signOut = vi.fn();

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
const withdrawAccount = vi.fn();
vi.mock("@/lib/auth/user", () => ({ withdrawUser }));
vi.mock("@/lib/auth/withdrawal", () => ({ withdrawAccount }));
vi.mock("@/lib/auth/withdrawnIdentity", () => ({ MissingIdentitySecretError: class extends Error {} }));
vi.mock("@/lib/auth/auth", () => ({ signOut }));
// Same reason as src/app/api/me/consent/route.test.ts: avoid
// pulling in the real @/lib/posts/http.ts's next-auth import chain.
vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response };
});

const { POST } = await import("./route");
const { MissingIdentitySecretError } = await import("@/lib/auth/withdrawnIdentity");
const req = (body?: unknown) =>
  new Request("http://localhost/api/me/withdraw", { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe("POST /api/me/withdraw", () => {
  it("rejects an unauthenticated request", async () => {
    getCurrentUser.mockResolvedValueOnce(null);

    const res = await POST(req());
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toMatch(/로그인/);
    expect(withdrawUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("withdraws the current user's own account -- id comes from the session, never the client", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 7 });
    withdrawUser.mockResolvedValueOnce({ kind: "ok", data: { id: 7, deletedAt: new Date() } });
    signOut.mockResolvedValueOnce(undefined);

    const res = await POST(req());
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
    withdrawUser.mockResolvedValueOnce({ kind: "ok", data: { id: 7, deletedAt: new Date() } });
    signOut.mockResolvedValueOnce(undefined);

    await POST(req());

    expect(signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it("does not sign out when withdrawUser itself throws", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 7 });
    withdrawUser.mockRejectedValueOnce(new Error("db down"));

    const res = await POST(req());

    expect(res.status).toBe(500);
    expect(signOut).not.toHaveBeenCalled();
  });

  // Phase 12-2: the sole-LEADER block -- withdrawUser() itself never
  // touches the User row or notifications in this case (see its own
  // comment), and this route must not sign the session out either, since
  // the account is still fully active.
  it("rejects withdrawal (without signing out) when the user is the sole LEADER of an organization", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 7 });
    withdrawUser.mockResolvedValueOnce({ kind: "sole_leader_block", organizationNames: ["명지대학교 총학생회"] });

    const res = await POST(req());
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain("명지대학교 총학생회");
    expect(signOut).not.toHaveBeenCalled();
  });

  // 회원탈퇴: { mode: "delete" } is the irreversible withdrawal, separate
  // from the reversible deactivation above.
  it("mode delete runs the irreversible withdrawal (not deactivation) and signs out", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 7 });
    withdrawAccount.mockResolvedValueOnce({ kind: "ok", held: false });
    signOut.mockResolvedValueOnce(undefined);

    const res = await POST(req({ mode: "delete" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.mode).toBe("delete");
    expect(withdrawAccount).toHaveBeenCalledWith(7);
    expect(withdrawUser).not.toHaveBeenCalledWith(7, expect.anything());
    expect(signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it("mode delete is refused (503, still signed in) when the identity secret is missing", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 7 });
    withdrawAccount.mockRejectedValueOnce(new MissingIdentitySecretError());
    signOut.mockClear();

    const res = await POST(req({ mode: "delete" }));

    expect(res.status).toBe(503);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("rejects an unknown mode", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 7 });
    const res = await POST(req({ mode: "erase-everything" }));
    expect(res.status).toBe(400);
  });
});
