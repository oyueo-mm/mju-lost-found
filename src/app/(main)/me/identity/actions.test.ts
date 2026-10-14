import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const requireReadyUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireReadyUser }));
const auth = vi.fn();
const unstable_update = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/auth/auth", () => ({ auth, unstable_update, signOut }));
const getOwnIdentityInfo = vi.fn();
const saveOwnIdentityInfo = vi.fn();
vi.mock("@/lib/identity/service", () => ({ getOwnIdentityInfo, saveOwnIdentityInfo }));
const createFeedback = vi.fn();
vi.mock("@/lib/feedback/service", () => ({ createFeedback }));

const { requestIdentityCorrectionAction, saveIdentityAction } = await import("./actions");

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const valid = { realName: "홍길동", department: "컴퓨터공학과" };

beforeEach(() => {
  vi.clearAllMocks();
  requireReadyUser.mockResolvedValue({ id: 7 });
  auth.mockResolvedValue(null);
  getOwnIdentityInfo.mockResolvedValue(null);
});

// 직접 입력: the exception path only. The consent itself is the required
// 개인정보 동의, which requireReadyUser already checks.
describe("saveIdentityAction", () => {
  it("saves typed values for an account Google can't fill", async () => {
    await expect(saveIdentityAction(null, form({ ...valid, callbackUrl: "/found/new" }))).rejects.toThrow("REDIRECT:/found/new");
    expect(requireReadyUser).toHaveBeenCalled();
    expect(saveOwnIdentityInfo).toHaveBeenCalledWith(7, { realName: "홍길동", department: "컴퓨터공학과" }, { realName: "self", department: "self" });
  });

  it("saves nothing when the required consent is missing (requireReadyUser redirects)", async () => {
    requireReadyUser.mockRejectedValueOnce(new Error("REDIRECT:/privacy-consent"));
    await expect(saveIdentityAction(null, form(valid))).rejects.toThrow(/^REDIRECT:\/privacy-consent$/);
    expect(saveOwnIdentityInfo).not.toHaveBeenCalled();
  });

  it("refuses to overwrite values collected from Google (read-only)", async () => {
    getOwnIdentityInfo.mockResolvedValueOnce({ realName: "x", department: "y", realNameSource: "google_display_name", departmentSource: "google_display_name" });
    expect(await saveIdentityAction(null, form(valid))).toEqual({ errors: { form: "identity.error.readOnly" } });
    expect(saveOwnIdentityInfo).not.toHaveBeenCalled();
  });

  it("reports every field problem at once", async () => {
    expect(await saveIdentityAction(null, form({ realName: "홍", department: "" }))).toEqual({
      errors: {
        realName: "identity.error.realName.invalid",
        department: "identity.error.department.required",
      },
    });
    expect(saveOwnIdentityInfo).not.toHaveBeenCalled();
  });

  it("credits a plain Google name kept as-is to Google", async () => {
    auth.mockResolvedValue({ identityHints: { name: "홍길동", department: null, nameSource: "google_profile" } });
    await expect(saveIdentityAction(null, form(valid))).rejects.toThrow("REDIRECT:/me");
    expect(saveOwnIdentityInfo).toHaveBeenCalledWith(7, expect.anything(), { realName: "google_profile", department: "self" });
    expect(unstable_update).toHaveBeenCalledWith({ clearIdentityHints: true });
  });

  it("never redirects off the site", async () => {
    await expect(saveIdentityAction(null, form({ ...valid, callbackUrl: "//evil.example" }))).rejects.toThrow(/^REDIRECT:\/me$/);
  });

  it("on a database failure, logs no submitted value", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    saveOwnIdentityInfo.mockRejectedValueOnce(Object.assign(new Error("홍길동 컴퓨터공학과 violates ..."), { code: "P2002" }));
    expect(await saveIdentityAction(null, form(valid))).toEqual({ errors: { form: "identity.error.failed" } });
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/홍길동|컴퓨터공학과/);
    consoleError.mockRestore();
  });
});

describe("requestIdentityCorrectionAction", () => {
  it("sends a 정정 요청 as a 문의 with a fixed title", async () => {
    createFeedback.mockResolvedValueOnce({ kind: "ok", data: {} });
    expect(await requestIdentityCorrectionAction(null, form({ content: "소속이 단과대학으로 표시돼요" }))).toEqual({ ok: true });
    expect(createFeedback).toHaveBeenCalledWith({ id: 7 }, { category: "other", title: "[이름·소속 정정 요청]", content: "소속이 단과대학으로 표시돼요" });
  });

  it("rejects an empty or overlong request", async () => {
    expect(await requestIdentityCorrectionAction(null, form({ content: "짧음" }))).toEqual({ error: "identity.correction.invalid" });
    expect(await requestIdentityCorrectionAction(null, form({ content: "가".repeat(1001) }))).toEqual({ error: "identity.correction.invalid" });
    expect(createFeedback).not.toHaveBeenCalled();
  });
});
