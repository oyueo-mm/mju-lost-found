import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/generated/prisma/client";

const requireReadyUser = vi.fn();
const createKeywordAlert = vi.fn();
const updateKeywordAlert = vi.fn();
const deleteKeywordAlert = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireReadyUser }));
vi.mock("@/lib/keywordAlert/service", () => ({ createKeywordAlert, updateKeywordAlert, deleteKeywordAlert }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { createKeywordAlertAction, updateKeywordAlertAction, deleteKeywordAlertAction } = await import("./actions");

const user = { id: 1 } as User;
const validInput = {
  keyword: "지갑",
  postType: "all",
  campuses: [],
  categories: [],
  excludeKeywords: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  requireReadyUser.mockResolvedValue(user);
});

describe("createKeywordAlertAction", () => {
  it("re-derives the user from requireReadyUser(), never trusting a caller-supplied id", async () => {
    createKeywordAlert.mockResolvedValueOnce({ kind: "ok", data: { id: 10 } });

    const result = await createKeywordAlertAction(validInput);

    expect(requireReadyUser).toHaveBeenCalledWith("mypost", "/me/keyword-alerts");
    expect(createKeywordAlert).toHaveBeenCalledWith(user, expect.objectContaining({ keyword: "지갑" }));
    expect(result).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/me/keyword-alerts");
  });

  it("rejects invalid input before ever calling the service", async () => {
    const result = await createKeywordAlertAction({ ...validInput, keyword: "a" });

    expect(result).toHaveProperty("error");
    expect(createKeywordAlert).not.toHaveBeenCalled();
  });

  it("surfaces the per-user cap as a Korean error message", async () => {
    createKeywordAlert.mockResolvedValueOnce({ kind: "too_many" });

    const result = await createKeywordAlertAction(validInput);

    expect(result).toEqual({ error: "키워드 알림은 최대 20개까지 만들 수 있어요." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateKeywordAlertAction", () => {
  it("updates the given alert id after re-deriving the user", async () => {
    updateKeywordAlert.mockResolvedValueOnce({ kind: "ok", data: { id: 10 } });

    const result = await updateKeywordAlertAction(10, validInput);

    expect(updateKeywordAlert).toHaveBeenCalledWith(user, 10, expect.objectContaining({ keyword: "지갑" }));
    expect(result).toEqual({ ok: true });
  });

  it("rejects invalid input before ever calling the service", async () => {
    const result = await updateKeywordAlertAction(10, { ...validInput, keyword: "a" });

    expect(result).toHaveProperty("error");
    expect(updateKeywordAlert).not.toHaveBeenCalled();
  });

  it("surfaces not_found as a Korean error message", async () => {
    updateKeywordAlert.mockResolvedValueOnce({ kind: "not_found" });

    const result = await updateKeywordAlertAction(999, validInput);

    expect(result).toEqual({ error: "키워드 알림을 찾을 수 없습니다." });
  });

  it("surfaces forbidden (another user's alert) as a Korean error message", async () => {
    updateKeywordAlert.mockResolvedValueOnce({ kind: "forbidden" });

    const result = await updateKeywordAlertAction(10, validInput);

    expect(result).toEqual({ error: "본인의 키워드 알림만 수정할 수 있습니다." });
  });
});

describe("deleteKeywordAlertAction", () => {
  it("deletes the given alert id after re-deriving the user", async () => {
    deleteKeywordAlert.mockResolvedValueOnce({ kind: "ok", data: { id: 10 } });

    const result = await deleteKeywordAlertAction(10);

    expect(deleteKeywordAlert).toHaveBeenCalledWith(user, 10);
    expect(result).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/me/keyword-alerts");
  });

  it("surfaces not_found as a Korean error message", async () => {
    deleteKeywordAlert.mockResolvedValueOnce({ kind: "not_found" });

    const result = await deleteKeywordAlertAction(999);

    expect(result).toEqual({ error: "키워드 알림을 찾을 수 없습니다." });
  });

  it("surfaces forbidden (another user's alert) as a Korean error message", async () => {
    deleteKeywordAlert.mockResolvedValueOnce({ kind: "forbidden" });

    const result = await deleteKeywordAlertAction(10);

    expect(result).toEqual({ error: "본인의 키워드 알림만 삭제할 수 있습니다." });
  });
});
