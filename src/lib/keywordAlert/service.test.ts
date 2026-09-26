import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/generated/prisma/client";
import { MAX_KEYWORD_ALERTS_PER_USER } from "./config";
import type { CreateKeywordAlertInput } from "./schema";

const keywordAlert = {
  findMany: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
const keywordAlertMatch = { findUnique: vi.fn() };

vi.mock("@/lib/db/prisma", () => ({
  prisma: { keywordAlert, keywordAlertMatch },
}));
vi.mock("@/generated/prisma/client", () => ({
  KeywordAlertPostType: { ALL: "ALL", LOST: "LOST", FOUND: "FOUND" },
}));

const {
  listKeywordAlerts,
  createKeywordAlert,
  updateKeywordAlert,
  deleteKeywordAlert,
  getKeywordAlertMatchForUser,
} = await import("./service");

const user = { id: 1 } as User;

const now = new Date("2026-01-01T00:00:00.000Z");
function alertRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    userId: 1,
    keyword: "지갑",
    postType: "ALL",
    campuses: [],
    categories: [],
    excludeKeywords: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const input: CreateKeywordAlertInput = {
  keyword: "지갑",
  postType: "all",
  campuses: [],
  categories: [],
  excludeKeywords: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listKeywordAlerts", () => {
  it("scopes the query to the caller's own userId and maps rows to DTOs", async () => {
    keywordAlert.findMany.mockResolvedValueOnce([alertRow()]);

    const result = await listKeywordAlerts(user);

    expect(keywordAlert.findMany).toHaveBeenCalledWith({
      where: { userId: 1 },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(result).toEqual([
      {
        id: 10,
        keyword: "지갑",
        postType: "all",
        campuses: [],
        categories: [],
        excludeKeywords: [],
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });
});

describe("createKeywordAlert", () => {
  it("creates a new alert scoped to the caller's userId", async () => {
    keywordAlert.count.mockResolvedValueOnce(0);
    keywordAlert.create.mockResolvedValueOnce(alertRow());

    const result = await createKeywordAlert(user, input);

    expect(keywordAlert.create).toHaveBeenCalledWith({
      data: {
        userId: 1,
        keyword: "지갑",
        postType: "ALL",
        campuses: [],
        categories: [],
        excludeKeywords: [],
      },
    });
    expect(result).toEqual({ kind: "ok", data: expect.objectContaining({ id: 10 }) });
  });

  it("rejects once the caller is at the per-user cap", async () => {
    keywordAlert.count.mockResolvedValueOnce(MAX_KEYWORD_ALERTS_PER_USER);

    const result = await createKeywordAlert(user, input);

    expect(result).toEqual({ kind: "too_many" });
    expect(keywordAlert.create).not.toHaveBeenCalled();
  });
});

describe("updateKeywordAlert", () => {
  it("updates an alert the caller owns", async () => {
    keywordAlert.findUnique.mockResolvedValueOnce(alertRow());
    keywordAlert.update.mockResolvedValueOnce(alertRow({ keyword: "핸드폰" }));

    const result = await updateKeywordAlert(user, 10, { ...input, keyword: "핸드폰" });

    expect(keywordAlert.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({ keyword: "핸드폰" }),
    });
    expect(result).toEqual({ kind: "ok", data: expect.objectContaining({ keyword: "핸드폰" }) });
  });

  it("returns not_found for a nonexistent alert", async () => {
    keywordAlert.findUnique.mockResolvedValueOnce(null);

    const result = await updateKeywordAlert(user, 999, input);

    expect(result).toEqual({ kind: "not_found" });
    expect(keywordAlert.update).not.toHaveBeenCalled();
  });

  it("returns forbidden when the alert belongs to another user", async () => {
    keywordAlert.findUnique.mockResolvedValueOnce(alertRow({ userId: 2 }));

    const result = await updateKeywordAlert(user, 10, input);

    expect(result).toEqual({ kind: "forbidden" });
    expect(keywordAlert.update).not.toHaveBeenCalled();
  });
});

describe("deleteKeywordAlert", () => {
  it("deletes an alert the caller owns", async () => {
    keywordAlert.findUnique.mockResolvedValueOnce(alertRow());

    const result = await deleteKeywordAlert(user, 10);

    expect(keywordAlert.delete).toHaveBeenCalledWith({ where: { id: 10 } });
    expect(result).toEqual({ kind: "ok", data: { id: 10 } });
  });

  it("returns not_found for a nonexistent alert", async () => {
    keywordAlert.findUnique.mockResolvedValueOnce(null);

    const result = await deleteKeywordAlert(user, 999);

    expect(result).toEqual({ kind: "not_found" });
    expect(keywordAlert.delete).not.toHaveBeenCalled();
  });

  it("returns forbidden when the alert belongs to another user", async () => {
    keywordAlert.findUnique.mockResolvedValueOnce(alertRow({ userId: 2 }));

    const result = await deleteKeywordAlert(user, 10);

    expect(result).toEqual({ kind: "forbidden" });
    expect(keywordAlert.delete).not.toHaveBeenCalled();
  });
});

describe("getKeywordAlertMatchForUser", () => {
  it("returns the match's postType/postId when it belongs to this user", async () => {
    keywordAlertMatch.findUnique.mockResolvedValueOnce({
      id: 5,
      postType: "lost",
      postId: 7,
      keywordAlert: { userId: 1 },
    });

    const result = await getKeywordAlertMatchForUser(5, 1);

    expect(keywordAlertMatch.findUnique).toHaveBeenCalledWith({
      where: { id: 5 },
      include: { keywordAlert: { select: { userId: true } } },
    });
    expect(result).toEqual({ postType: "lost", postId: 7 });
  });

  it("returns null when the match's alert belongs to a different user", async () => {
    keywordAlertMatch.findUnique.mockResolvedValueOnce({
      id: 5,
      postType: "lost",
      postId: 7,
      keywordAlert: { userId: 2 },
    });

    const result = await getKeywordAlertMatchForUser(5, 1);

    expect(result).toBeNull();
  });

  it("returns null when the match no longer exists", async () => {
    keywordAlertMatch.findUnique.mockResolvedValueOnce(null);

    const result = await getKeywordAlertMatchForUser(999, 1);

    expect(result).toBeNull();
  });
});
