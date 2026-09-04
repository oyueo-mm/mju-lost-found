import { beforeEach, describe, expect, it, vi } from "vitest";

class FakePrismaClientKnownRequestError extends Error {
  code: string;
  constructor(code: string) {
    super("mock prisma error");
    this.code = code;
  }
}

const requireUser = vi.fn();
const updateMany = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { updateMany } } }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/generated/prisma/client", () => ({
  Prisma: { PrismaClientKnownRequestError: FakePrismaClientKnownRequestError },
}));

const { setNicknameAction } = await import("./actions");

beforeEach(() => {
  requireUser.mockReset();
  updateMany.mockReset();
  redirect.mockClear();
});

describe("setNicknameAction", () => {
  it("only ever updates the current session's own user (id comes from requireUser(), never the form)", async () => {
    requireUser.mockResolvedValueOnce({ id: 7, nickname: null });
    updateMany.mockResolvedValueOnce({ count: 1 });

    const form = new FormData();
    form.set("nickname", "새닉네임");
    // Even if a form somehow carried a userId field, the action never reads
    // one -- requireUser() is the only source of the id used in the write.
    form.set("userId", "999");

    await expect(setNicknameAction(null, form)).rejects.toThrow("REDIRECT:/");

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 7, nickname: null },
      data: { nickname: "새닉네임" },
    });
  });

  it("rejects an invalid nickname server-side without writing to the DB", async () => {
    requireUser.mockResolvedValueOnce({ id: 7, nickname: null });

    const form = new FormData();
    form.set("nickname", "a"); // too short

    const result = await setNicknameAction(null, form);

    expect(result?.error).toBeTruthy();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does nothing and redirects home if the user already has a nickname", async () => {
    requireUser.mockResolvedValueOnce({ id: 7, nickname: "이미설정됨" });

    const form = new FormData();
    form.set("nickname", "다른닉네임");

    await expect(setNicknameAction(null, form)).rejects.toThrow("REDIRECT:/");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("reports a friendly error when the nickname is already taken by someone else", async () => {
    requireUser.mockResolvedValueOnce({ id: 7, nickname: null });
    updateMany.mockRejectedValueOnce(new FakePrismaClientKnownRequestError("P2002"));

    const form = new FormData();
    form.set("nickname", "중복닉네임");

    const result = await setNicknameAction(null, form);

    expect(result).toEqual({ error: "이미 사용 중인 닉네임입니다." });
  });
});
