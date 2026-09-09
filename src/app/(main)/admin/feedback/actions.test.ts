import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const updateFeedbackStatus = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireAdmin }));
vi.mock("@/lib/feedback/service", () => ({ updateFeedbackStatus }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { updateFeedbackStatusAction } = await import("./actions");

const admin = { id: 1, isAdmin: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateFeedbackStatusAction", () => {
  it("calls requireAdmin() before doing anything else", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(updateFeedbackStatusAction(10, { status: "in_review" })).rejects.toThrow();

    expect(updateFeedbackStatus).not.toHaveBeenCalled();
  });

  it("rejects an invalid status before calling the service", async () => {
    requireAdmin.mockResolvedValueOnce(admin);

    const result = await updateFeedbackStatusAction(10, { status: "not-a-real-status" });

    expect(result).toEqual({ error: expect.any(String) });
    expect(updateFeedbackStatus).not.toHaveBeenCalled();
  });

  it("returns an error for a nonexistent feedback", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    updateFeedbackStatus.mockResolvedValueOnce({ kind: "not_found" });

    const result = await updateFeedbackStatusAction(999, { status: "in_review" });

    expect(result).toEqual({ error: expect.any(String) });
  });

  it("updates and revalidates both the admin list and detail page", async () => {
    requireAdmin.mockResolvedValueOnce(admin);
    updateFeedbackStatus.mockResolvedValueOnce({ kind: "ok", data: { id: 10 } });

    const result = await updateFeedbackStatusAction(10, { status: "planned", adminNote: "다음 스프린트" });

    expect(result).toEqual({ ok: true });
    expect(updateFeedbackStatus).toHaveBeenCalledWith(admin, 10, { status: "planned", adminNote: "다음 스프린트" });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/feedback");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/feedback/10");
  });
});
