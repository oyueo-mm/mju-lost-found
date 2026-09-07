import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
const update = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { update } } }));

const { updateNicknameAction } = await import("./actions");

beforeEach(() => {
  requireUser.mockReset();
  update.mockReset();
});

describe("updateNicknameAction", () => {
  it("only ever updates the current session's own user (id comes from requireUser(), never the form)", async () => {
    requireUser.mockResolvedValueOnce({ id: 7, nickname: "기존닉네임" });
    update.mockResolvedValueOnce({});

    const form = new FormData();
    form.set("nickname", "새닉네임");
    // Even if a form somehow carried a userId field, the action never reads
    // one -- requireUser() is the only source of the id used in the write.
    form.set("userId", "999");

    const result = await updateNicknameAction(null, form);

    expect(update).toHaveBeenCalledWith({ where: { id: 7 }, data: { nickname: "새닉네임" } });
    expect(result).toEqual({ ok: true, nickname: "새닉네임" });
  });

  it("rejects an invalid nickname server-side without writing to the DB", async () => {
    requireUser.mockResolvedValueOnce({ id: 7, nickname: "기존닉네임" });

    const form = new FormData();
    form.set("nickname", "a"); // too short

    const result = await updateNicknameAction(null, form);

    expect("error" in result && result.error).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  // Phase H-7: duplicate nicknames are allowed by design -- there is no
  // uniqueness check/error path to test here, unlike the old onboarding
  // flow before this phase.
  it("allows changing to a nickname another user already has", async () => {
    requireUser.mockResolvedValueOnce({ id: 7, nickname: "기존닉네임" });
    update.mockResolvedValueOnce({});

    const form = new FormData();
    form.set("nickname", "중복닉네임");

    const result = await updateNicknameAction(null, form);

    expect(result).toEqual({ ok: true, nickname: "중복닉네임" });
  });

  it("allows changing an already-set nickname (unlike onboarding's set-once)", async () => {
    requireUser.mockResolvedValueOnce({ id: 7, nickname: "이전닉네임" });
    update.mockResolvedValueOnce({});

    const form = new FormData();
    form.set("nickname", "바뀐닉네임");

    await updateNicknameAction(null, form);

    // No "where: { nickname: null }" guard here, unlike
    // onboarding/actions.ts's setNicknameAction -- this action is meant to
    // change an existing, non-null nickname.
    expect(update).toHaveBeenCalledWith({ where: { id: 7 }, data: { nickname: "바뀐닉네임" } });
  });
});
