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
    requireUser.mockResolvedValueOnce({ id: 7, nickname: "기존닉네임", nicknameChangeAvailableAt: null });
    update.mockResolvedValueOnce({});

    const form = new FormData();
    form.set("nickname", "새닉네임");
    // Even if a form somehow carried a userId field, the action never reads
    // one -- requireUser() is the only source of the id used in the write.
    form.set("userId", "999");

    const result = await updateNicknameAction(null, form);

    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { nickname: "새닉네임", nicknameChangeAvailableAt: expect.any(Date) },
    });
    expect(result).toEqual({ ok: true, nickname: "새닉네임" });
  });

  it("rejects an invalid nickname server-side without writing to the DB", async () => {
    requireUser.mockResolvedValueOnce({ id: 7, nickname: "기존닉네임", nicknameChangeAvailableAt: null });

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
    requireUser.mockResolvedValueOnce({ id: 7, nickname: "기존닉네임", nicknameChangeAvailableAt: null });
    update.mockResolvedValueOnce({});

    const form = new FormData();
    form.set("nickname", "중복닉네임");

    const result = await updateNicknameAction(null, form);

    expect(result).toEqual({ ok: true, nickname: "중복닉네임" });
  });

  it("allows changing an already-set nickname (unlike onboarding's set-once)", async () => {
    requireUser.mockResolvedValueOnce({ id: 7, nickname: "이전닉네임", nicknameChangeAvailableAt: null });
    update.mockResolvedValueOnce({});

    const form = new FormData();
    form.set("nickname", "바뀐닉네임");

    await updateNicknameAction(null, form);

    // No "where: { nickname: null }" guard here, unlike
    // onboarding/actions.ts's setNicknameAction -- this action is meant to
    // change an existing, non-null nickname.
    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { nickname: "바뀐닉네임", nicknameChangeAvailableAt: expect.any(Date) },
    });
  });

  // Phase I section 7.
  describe("cooldown", () => {
    it("rejects a change while the cooldown is still active, without writing to the DB", async () => {
      const availableAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days from now
      requireUser.mockResolvedValueOnce({ id: 7, nickname: "기존닉네임", nicknameChangeAvailableAt: availableAt });

      const form = new FormData();
      form.set("nickname", "새닉네임");

      const result = await updateNicknameAction(null, form);

      expect(result).toEqual({ onCooldown: true, availableAt });
      expect(update).not.toHaveBeenCalled();
    });

    it("allows a change once the cooldown instant has passed", async () => {
      const pastAvailableAt = new Date(Date.now() - 1000);
      requireUser.mockResolvedValueOnce({ id: 7, nickname: "기존닉네임", nicknameChangeAvailableAt: pastAvailableAt });
      update.mockResolvedValueOnce({});

      const form = new FormData();
      form.set("nickname", "새닉네임");

      const result = await updateNicknameAction(null, form);

      expect(result).toEqual({ ok: true, nickname: "새닉네임" });
      expect(update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { nickname: "새닉네임", nicknameChangeAvailableAt: expect.any(Date) },
      });
    });

    it("stamps a new nicknameChangeAvailableAt roughly NICKNAME_CHANGE_COOLDOWN_DAYS in the future", async () => {
      requireUser.mockResolvedValueOnce({ id: 7, nickname: "기존닉네임", nicknameChangeAvailableAt: null });
      update.mockResolvedValueOnce({});

      const form = new FormData();
      form.set("nickname", "새닉네임");

      const before = Date.now();
      await updateNicknameAction(null, form);
      const after = Date.now();

      const [[call]] = update.mock.calls;
      const stamped = (call.data.nicknameChangeAvailableAt as Date).getTime();
      const days = 7 * 24 * 60 * 60 * 1000;
      expect(stamped).toBeGreaterThanOrEqual(before + days - 1000);
      expect(stamped).toBeLessThanOrEqual(after + days + 1000);
    });
  });
});
