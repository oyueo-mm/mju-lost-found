import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchablePost } from "./matcher";

class FakePrismaClientKnownRequestError extends Error {
  code: string;
  constructor(code: string) {
    super("mock prisma error");
    this.code = code;
  }
}

const keywordAlert = { findMany: vi.fn() };
const txKeywordAlertMatch = { create: vi.fn() };
const txNotification = { create: vi.fn() };
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({ keywordAlertMatch: txKeywordAlertMatch, notification: txNotification }),
);

vi.mock("@/lib/db/prisma", () => ({
  prisma: { keywordAlert, $transaction },
}));
vi.mock("@/generated/prisma/client", () => ({
  NotificationType: { KEYWORD_ALERT_MATCH: "KEYWORD_ALERT_MATCH" },
  Prisma: { PrismaClientKnownRequestError: FakePrismaClientKnownRequestError },
}));

const { notifyKeywordAlertSubscribers } = await import("./matcher");

const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  txKeywordAlertMatch.create.mockResolvedValue({ id: 100 });
});

function alertRow(overrides: Partial<{
  id: number;
  userId: number;
  keyword: string;
  campuses: string[];
  categories: string[];
  excludeKeywords: string[];
}> = {}) {
  return {
    id: 1,
    userId: 2,
    keyword: "지갑",
    campuses: [],
    categories: [],
    excludeKeywords: [],
    ...overrides,
  };
}

function post(overrides: Partial<MatchablePost> = {}): MatchablePost {
  return {
    id: 10,
    userId: 99,
    title: "검정 지갑을 잃어버렸어요",
    description: "인문관 앞에서 잃어버렸습니다",
    campus: "서울캠퍼스",
    category: "지갑",
    ...overrides,
  };
}

describe("notifyKeywordAlertSubscribers", () => {
  it("does nothing when no alerts exist for this post type", async () => {
    keywordAlert.findMany.mockResolvedValueOnce([]);

    await notifyKeywordAlertSubscribers("lost", post());

    expect($transaction).not.toHaveBeenCalled();
  });

  it("excludes the post author's own userId from the query itself", async () => {
    keywordAlert.findMany.mockResolvedValueOnce([]);

    await notifyKeywordAlertSubscribers("lost", post({ userId: 42 }));

    expect(keywordAlert.findMany).toHaveBeenCalledWith({
      where: { userId: { not: 42 }, postType: { in: ["ALL", "LOST"] } },
    });
  });

  it("filters by postType=ALL/FOUND for a found post", async () => {
    keywordAlert.findMany.mockResolvedValueOnce([]);

    await notifyKeywordAlertSubscribers("found", post());

    expect(keywordAlert.findMany).toHaveBeenCalledWith({
      where: { userId: { not: 99 }, postType: { in: ["ALL", "FOUND"] } },
    });
  });

  it("creates a match + notification when the keyword is found in the title", async () => {
    keywordAlert.findMany.mockResolvedValueOnce([alertRow({ keyword: "지갑" })]);

    await notifyKeywordAlertSubscribers("lost", post());

    expect(txKeywordAlertMatch.create).toHaveBeenCalledWith({
      data: { keywordAlertId: 1, postType: "lost", postId: 10 },
    });
    expect(txNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 2,
        type: "KEYWORD_ALERT_MATCH",
        relatedType: "keyword_alert_match",
        relatedId: 100,
      }),
    });
  });

  it("matches case-insensitively against title+description", async () => {
    keywordAlert.findMany.mockResolvedValueOnce([alertRow({ keyword: "WALLET" })]);

    await notifyKeywordAlertSubscribers(
      "lost",
      post({ title: "lost my Wallet", description: "" }),
    );

    expect(txKeywordAlertMatch.create).toHaveBeenCalled();
  });

  it("does not match when the keyword is absent", async () => {
    keywordAlert.findMany.mockResolvedValueOnce([alertRow({ keyword: "우산" })]);

    await notifyKeywordAlertSubscribers("lost", post());

    expect($transaction).not.toHaveBeenCalled();
  });

  it("skips a match blocked by an exclude keyword", async () => {
    keywordAlert.findMany.mockResolvedValueOnce([
      alertRow({ keyword: "지갑", excludeKeywords: ["인문관"] }),
    ]);

    await notifyKeywordAlertSubscribers("lost", post());

    expect($transaction).not.toHaveBeenCalled();
  });

  it("requires the post's campus to be in a non-empty campuses filter", async () => {
    keywordAlert.findMany.mockResolvedValueOnce([
      alertRow({ keyword: "지갑", campuses: ["자연캠퍼스"] }),
    ]);

    await notifyKeywordAlertSubscribers("lost", post({ campus: "서울캠퍼스" }));

    expect($transaction).not.toHaveBeenCalled();
  });

  it("passes when the post's campus is included in the campuses filter", async () => {
    keywordAlert.findMany.mockResolvedValueOnce([
      alertRow({ keyword: "지갑", campuses: ["서울캠퍼스"] }),
    ]);

    await notifyKeywordAlertSubscribers("lost", post({ campus: "서울캠퍼스" }));

    expect($transaction).toHaveBeenCalled();
  });

  it("requires the post's category to be in a non-empty categories filter", async () => {
    keywordAlert.findMany.mockResolvedValueOnce([
      alertRow({ keyword: "지갑", categories: ["전자기기"] }),
    ]);

    await notifyKeywordAlertSubscribers("lost", post({ category: "지갑" }));

    expect($transaction).not.toHaveBeenCalled();
  });

  it("evaluates multiple alerts independently, only matching ones create notifications", async () => {
    keywordAlert.findMany.mockResolvedValueOnce([
      alertRow({ id: 1, keyword: "지갑" }),
      alertRow({ id: 2, keyword: "우산" }),
    ]);

    await notifyKeywordAlertSubscribers("lost", post());

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(txKeywordAlertMatch.create).toHaveBeenCalledWith({
      data: { keywordAlertId: 1, postType: "lost", postId: 10 },
    });
  });

  it("silently skips a P2002 duplicate-match error without logging", async () => {
    keywordAlert.findMany.mockResolvedValueOnce([alertRow()]);
    $transaction.mockRejectedValueOnce(new FakePrismaClientKnownRequestError("P2002"));

    await notifyKeywordAlertSubscribers("lost", post());

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("logs but does not throw on a non-P2002 error, and still processes the remaining alerts", async () => {
    keywordAlert.findMany.mockResolvedValueOnce([
      alertRow({ id: 1, keyword: "지갑" }),
      alertRow({ id: 2, keyword: "지갑" }),
    ]);
    $transaction.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce(undefined);

    await expect(notifyKeywordAlertSubscribers("lost", post())).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it("never throws even when the initial findMany query itself fails", async () => {
    keywordAlert.findMany.mockRejectedValueOnce(new Error("db down"));

    await expect(notifyKeywordAlertSubscribers("lost", post())).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});
