import { describe, expect, it, vi } from "vitest";

// Captures what auth.ts hands to NextAuth and to the Google provider.
type Callbacks = {
  signIn: (args: unknown) => Promise<boolean>;
  jwt: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  session: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
let config: { callbacks: Callbacks } | null = null;
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
const resolveSignIn = vi.fn();
vi.mock("@/lib/auth/user", () => ({ resolveSignIn }));
const fetchDepartmentHint = vi.fn();
vi.mock("@/lib/identity/googleHints", async () => {
  const actual = await vi.importActual<typeof import("@/lib/identity/googleHints")>("@/lib/identity/googleHints");
  return { ...actual, fetchDepartmentHint };
});

await import("./auth");

describe("Google sign-in configuration", () => {
  // Login UX: the account chooser is always shown, so a user rejected with
  // a non-allowed account can pick their @mju.ac.kr account next time.
  // 실명·학과 자동 입력: "profile" for the Google name suggestion; the
  // department scope stays off unless GOOGLE_ORG_SCOPE_ENABLED=true.
  it("asks Google to show the account chooser, with openid email profile", () => {
    expect(googleOptions).toHaveLength(1);
    expect(googleOptions[0]).toMatchObject({
      authorization: { params: { scope: "openid email profile", prompt: "select_account" } },
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

describe("실명·학과 자동 입력 in the session", () => {
  const signIn = (profile: unknown) =>
    config!.callbacks.jwt({
      token: { name: "Google Name", picture: "https://lh3.example/photo.jpg", email: "student@mju.ac.kr" },
      user: { email: "student@mju.ac.kr", name: "Google Name" },
      account: { providerAccountId: "g-1", access_token: "at-1" },
      profile,
    });

  it("keeps the Google name only as a form hint: never sent to the DB, name/picture claims dropped", async () => {
    resolveSignIn.mockResolvedValueOnce({ kind: "user", user: { id: 7, nickname: "닉" } });

    const token = await signIn({ name: "홍길동", picture: "https://lh3.example/photo.jpg" });

    expect(resolveSignIn).toHaveBeenLastCalledWith({ email: "student@mju.ac.kr", name: null, googleId: "g-1" });
    expect(token).toMatchObject({ userId: 7, identityHints: { name: "홍길동", department: null } });
    expect(token).not.toHaveProperty("name");
    expect(token).not.toHaveProperty("picture");
    // The department scope is off by default: no People API call.
    expect(fetchDepartmentHint).not.toHaveBeenCalled();
  });

  it("gives a held (withdrawn) identity no hints", async () => {
    resolveSignIn.mockResolvedValueOnce({ kind: "held", identityId: 3 });
    const token = await signIn({ name: "홍길동" });
    expect(token).not.toHaveProperty("identityHints");
  });

  it("drops the hints once the form is saved (session update)", async () => {
    const token = await config!.callbacks.jwt({
      token: { userId: 7, identityHints: { name: "홍길동", department: null } },
      trigger: "update",
      session: { clearIdentityHints: true },
    });
    expect(token).not.toHaveProperty("identityHints");
  });

  it("exposes the member's own hints but never the Google name or picture in the session", async () => {
    const session = await config!.callbacks.session({
      session: { user: { name: "Google Name", image: "https://lh3.example/photo.jpg", email: "student@mju.ac.kr" } },
      token: { userId: 7, nickname: "닉", identityHints: { name: "홍길동", department: null } },
    });
    expect(session).toMatchObject({ identityHints: { name: "홍길동", department: null }, user: { id: "7", name: null, image: null } });
  });

  it("splits an 이름/신분/소속 Google name into name and affiliation hints, never keeping the whole name", async () => {
    resolveSignIn.mockResolvedValueOnce({ kind: "user", user: { id: 7, nickname: "닉" } });
    const token = await signIn({ name: "홍길동/학생/컴퓨터공학과" });
    expect(token.identityHints).toEqual({
      name: "홍길동",
      department: "컴퓨터공학과",
      nameSource: "google_display_name",
      departmentSource: "google_display_name",
    });
    expect(JSON.stringify(token)).not.toContain("학생/");
  });

  it("a malformed structured name gives no hint at all (no wrong name or department)", async () => {
    resolveSignIn.mockResolvedValueOnce({ kind: "user", user: { id: 7, nickname: "닉" } });
    const token = await signIn({ name: "홍길동/졸업생/컴퓨터공학과" });
    expect(token.identityHints).toEqual({ name: null, department: null });
  });

  it("with the department scope on, a People API department takes precedence over the display-name affiliation", async () => {
    process.env.GOOGLE_ORG_SCOPE_ENABLED = "true";
    try {
      resolveSignIn.mockResolvedValueOnce({ kind: "user", user: { id: 7, nickname: "닉" } });
      fetchDepartmentHint.mockResolvedValueOnce("경영학과");
      const token = await signIn({ name: "홍길동/학생/경영대학" });
      expect(fetchDepartmentHint).toHaveBeenCalledWith("at-1");
      expect(token.identityHints).toEqual({
        name: "홍길동",
        department: "경영학과",
        nameSource: "google_display_name",
        departmentSource: "google_people",
      });
    } finally {
      delete process.env.GOOGLE_ORG_SCOPE_ENABLED;
    }
  });
});
