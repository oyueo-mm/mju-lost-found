import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const requireReadyUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireReadyUser }));
const auth = vi.fn();
const unstable_update = vi.fn();
vi.mock("@/lib/auth/auth", () => ({ auth, unstable_update }));
const saveOwnIdentityInfo = vi.fn();
vi.mock("@/lib/identity/service", () => ({ saveOwnIdentityInfo }));

const { saveIdentityAction } = await import("./actions");

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const valid = { realName: "홍길동", department: "컴퓨터공학과", consent: "on" };

beforeEach(() => {
  vi.clearAllMocks();
  requireReadyUser.mockResolvedValue({ id: 7 });
  auth.mockResolvedValue(null);
});

describe("saveIdentityAction", () => {
  it("saves the session member's own values and returns to where they came from", async () => {
    await expect(saveIdentityAction(null, form({ ...valid, callbackUrl: "/found/new" }))).rejects.toThrow("REDIRECT:/found/new");
    expect(saveOwnIdentityInfo).toHaveBeenCalledWith(7, { realName: "홍길동", department: "컴퓨터공학과" }, { realName: "self", department: "self" });
  });

  it("never redirects off the site", async () => {
    await expect(saveIdentityAction(null, form({ ...valid, callbackUrl: "https://evil.example/" }))).rejects.toThrow(/^REDIRECT:\/me$/);
    await expect(saveIdentityAction(null, form({ ...valid, callbackUrl: "//evil.example" }))).rejects.toThrow(/^REDIRECT:\/me$/);
    await expect(saveIdentityAction(null, form({ ...valid, callbackUrl: "/\\evil.example" }))).rejects.toThrow(/^REDIRECT:\/me$/);
  });

  it("goes home after onboarding", async () => {
    await expect(saveIdentityAction(null, form({ ...valid, onboarding: "1" }))).rejects.toThrow(/^REDIRECT:\/$/);
  });

  it("does not save without the consent checkbox, and reports every field problem at once", async () => {
    const result = await saveIdentityAction(null, form({ realName: "홍", department: "" }));
    expect(result).toEqual({
      errors: {
        realName: "identity.error.realName.invalid",
        department: "identity.error.department.required",
        consent: "identity.error.consent",
      },
    });
    expect(saveOwnIdentityInfo).not.toHaveBeenCalled();
  });

  it("on a database failure, logs no submitted value", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    saveOwnIdentityInfo.mockRejectedValueOnce(Object.assign(new Error("홍길동 컴퓨터공학과 violates ..."), { code: "P2002" }));

    const result = await saveIdentityAction(null, form(valid));

    expect(result).toEqual({ errors: { form: "identity.error.failed" } });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain("홍길동");
    expect(logged).not.toContain("컴퓨터공학과");
  });

  // 실명·학과 자동 입력: a Google suggestion reaches the DB only through
  // this consented save, marked as kept-as-suggested or edited.
  it("records whether each value is the Google suggestion as-is, then drops the suggestions from the session", async () => {
    auth.mockResolvedValue({ identityHints: { name: "홍길동", department: "학생지원팀" } });

    await expect(saveIdentityAction(null, form({ realName: "홍길동", department: "컴퓨터공학과", consent: "on" }))).rejects.toThrow("REDIRECT:/me");

    expect(saveOwnIdentityInfo).toHaveBeenCalledWith(
      7,
      { realName: "홍길동", department: "컴퓨터공학과" },
      { realName: "google_profile", department: "self" },
    );
    expect(unstable_update).toHaveBeenCalledWith({ clearIdentityHints: true });
  });

  it("stores nothing from the suggestions without the consent checkbox", async () => {
    auth.mockResolvedValue({ identityHints: { name: "홍길동", department: null } });
    const result = await saveIdentityAction(null, form({ realName: "홍길동", department: "컴퓨터공학과" }));
    expect(result).toEqual({ errors: { consent: "identity.error.consent" } });
    expect(saveOwnIdentityInfo).not.toHaveBeenCalled();
    expect(unstable_update).not.toHaveBeenCalled();
  });

  it("records google_display_name when the display-name values are kept, and self for an edited one", async () => {
    auth.mockResolvedValue({
      identityHints: { name: "홍길동", department: "경영대학", nameSource: "google_display_name", departmentSource: "google_display_name" },
    });
    await expect(saveIdentityAction(null, form({ realName: "홍길동", department: "경영대학", consent: "on" }))).rejects.toThrow("REDIRECT:/me");
    expect(saveOwnIdentityInfo).toHaveBeenLastCalledWith(
      7,
      { realName: "홍길동", department: "경영대학" },
      { realName: "google_display_name", department: "google_display_name" },
    );

    await expect(saveIdentityAction(null, form({ realName: "홍길동", department: "경영학과", consent: "on" }))).rejects.toThrow("REDIRECT:/me");
    expect(saveOwnIdentityInfo).toHaveBeenLastCalledWith(
      7,
      { realName: "홍길동", department: "경영학과" },
      { realName: "google_display_name", department: "self" },
    );
  });
});

