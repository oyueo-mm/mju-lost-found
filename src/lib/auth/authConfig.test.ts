import { describe, expect, it, vi } from "vitest";

// Captures what auth.ts hands to NextAuth and to the Google provider.
let config: { callbacks: { signIn: (args: unknown) => Promise<boolean> } } | null = null;
const googleOptions: unknown[] = [];
vi.mock("next-auth", () => ({
  default: (c: typeof config) => {
    config = c;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/google", () => ({
  default: (options: unknown) => {
    googleOptions.push(options);
    return { id: "google", options };
  },
}));
const decideSignIn = vi.fn();
vi.mock("@/lib/auth/access", () => ({ decideSignIn }));
vi.mock("@/lib/auth/user", () => ({ resolveSignIn: vi.fn() }));

await import("./auth");

describe("Google sign-in configuration", () => {
  // Login UX: the account chooser is always shown, so a user rejected with
  // a non-allowed account can pick their @mju.ac.kr account next time.
  it("asks Google to show the account chooser, with the same minimal scope", () => {
    expect(googleOptions).toHaveLength(1);
    expect(googleOptions[0]).toMatchObject({
      authorization: { params: { scope: "openid email", prompt: "select_account" } },
    });
  });

  // The account restriction itself is untouched: the signIn callback still
  // allows exactly what decideSignIn allows.
  it("still lets only decideSignIn decide who may sign in", async () => {
    decideSignIn.mockResolvedValueOnce({ allowed: false });
    await expect(config!.callbacks.signIn({ user: { email: "someone@gmail.com" }, profile: { email_verified: true } })).resolves.toBe(false);
    expect(decideSignIn).toHaveBeenLastCalledWith("someone@gmail.com", true);

    decideSignIn.mockResolvedValueOnce({ allowed: true });
    await expect(config!.callbacks.signIn({ user: { email: "student@mju.ac.kr" }, profile: { email_verified: true } })).resolves.toBe(true);
  });
});
