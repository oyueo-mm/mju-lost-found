import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const requireReadyUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireReadyUser }));
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
});

describe("saveIdentityAction", () => {
  it("saves the session member's own values and returns to where they came from", async () => {
    await expect(saveIdentityAction(null, form({ ...valid, callbackUrl: "/found/new" }))).rejects.toThrow("REDIRECT:/found/new");
    expect(saveOwnIdentityInfo).toHaveBeenCalledWith(7, { realName: "홍길동", department: "컴퓨터공학과" });
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
});
