import { beforeEach, describe, expect, it, vi } from "vitest";

const requireActiveUser = vi.fn();
const createFeedback = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireActiveUser }));
vi.mock("@/lib/feedback/service", () => ({ createFeedback }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { createFeedbackAction } = await import("./actions");

const user = { id: 2, isAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
});

// "서버에서 auth를 반드시 재검증한다" -- requireActiveUser() redirects
// (never returns) for a logged-out/not-ready/suspended caller, so the
// action never even reaches input validation in that case.
describe("createFeedbackAction", () => {
  it("calls requireActiveUser() before doing anything else", async () => {
    requireActiveUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(
      createFeedbackAction({ category: "bug", title: "t", content: "c" }),
    ).rejects.toThrow();

    expect(createFeedback).not.toHaveBeenCalled();
  });

  it("rejects an invalid category before calling the service", async () => {
    requireActiveUser.mockResolvedValueOnce(user);

    const result = await createFeedbackAction({ category: "not-a-real-category", title: "t", content: "c" });

    expect(result).toEqual({ error: expect.any(String) });
    expect(createFeedback).not.toHaveBeenCalled();
  });

  it("rejects an empty title before calling the service", async () => {
    requireActiveUser.mockResolvedValueOnce(user);

    const result = await createFeedbackAction({ category: "bug", title: "  ", content: "내용" });

    expect(result).toEqual({ error: expect.any(String) });
    expect(createFeedback).not.toHaveBeenCalled();
  });

  it("creates the feedback via the service (which itself attaches the caller's own userId) and revalidates", async () => {
    requireActiveUser.mockResolvedValueOnce(user);
    createFeedback.mockResolvedValueOnce({ kind: "ok", data: { id: 10 } });

    const result = await createFeedbackAction({
      category: "feature_request",
      title: "검색 필터가 있었으면 좋겠어요",
      content: "검색 결과가 너무 많습니다",
    });

    expect(result).toEqual({ ok: true });
    expect(createFeedback).toHaveBeenCalledWith(user, {
      category: "feature_request",
      title: "검색 필터가 있었으면 좋겠어요",
      content: "검색 결과가 너무 많습니다",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/feedback");
  });
});
