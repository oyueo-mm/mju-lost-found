import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  pushOutbox: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  pushSubscription: { findMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), count: vi.fn(), upsert: vi.fn() },
  chatRoom: { findUnique: vi.fn() },
  chatPresence: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
};
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("web-push", () => ({ default: { sendNotification: vi.fn() } }));
const { chatPushPayload, deliverPush, deliverWithRetry, enqueueChatPush, sweepPendingPushes, validSubscription, PRESENCE_FRESH_MS, PUSH_SWEEP_MIN_AGE_MS, PUSH_RETRY_DELAY_MS } = await import("./service");
const { pushEnvironment } = await import("./environment");

const NOW = new Date("2026-11-03T12:00:00Z");
const row = (over = {}) => ({ id: 1, userId: 20, attempts: 0, sentAt: null, skipped: null, message: { chatRoomId: 7, senderUserId: 10, hiddenAt: null }, ...over });
const subs = [{ id: 100, endpoint: "https://push.example/a", p256dh: "k", auth: "a" }, { id: 101, endpoint: "https://push.example/b", p256dh: "k", auth: "a" }];
beforeEach(() => {
  vi.clearAllMocks();
  db.pushOutbox.findUnique.mockResolvedValue(row());
  db.pushOutbox.updateMany.mockResolvedValue({ count: 1 });
  db.chatRoom.findUnique.mockResolvedValue({ organizationId: null, initiatorUserId: 10, counterpartUserId: 20 });
  db.user.findUnique.mockResolvedValue({ withdrawnAt: null });
  db.chatPresence.findUnique.mockResolvedValue(null);
  db.pushSubscription.findMany.mockResolvedValue(subs);
  db.pushSubscription.update.mockResolvedValue({ failureCount: 1 });
});
const ok = vi.fn<(sub: unknown, payload: string) => Promise<{ statusCode: number }>>(async () => ({ statusCode: 201 }));

describe("chat push payload", () => {
  it("carries no message text, title or name -- only the room link", () => {
    expect(chatPushPayload(7)).toEqual({ title: "MJU Find", body: "새로운 채팅 메시지가 도착했어요.", url: "/chat/7", tag: "chat-7" });
  });
});

describe("enqueueChatPush", () => {
  it("queues one row only when the receiver has a subscription", async () => {
    db.pushSubscription.count.mockResolvedValueOnce(0);
    expect(await enqueueChatPush(db as never, 55, 20)).toBeNull();
    expect(db.pushOutbox.create).not.toHaveBeenCalled();
    db.pushSubscription.count.mockResolvedValueOnce(2);
    db.pushOutbox.create.mockResolvedValueOnce({ id: 9 });
    expect(await enqueueChatPush(db as never, 55, 20)).toBe(9);
    expect(db.pushOutbox.create).toHaveBeenCalledWith({ data: { messageId: 55, userId: 20 }, select: { id: true } });
  });
});

describe("deliverPush", () => {
  it("sends to every device of the receiver and marks the row sent", async () => {
    expect(await deliverPush(1, { send: ok, now: NOW })).toBe("sent");
    expect(ok).toHaveBeenCalledTimes(2);
    expect(JSON.parse(ok.mock.calls[0][1])).toEqual(chatPushPayload(7));
    expect(db.pushOutbox.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { sentAt: NOW, lastError: null } });
  });

  it("claims with compare-and-set: a second runner (or a duplicate event) sends nothing", async () => {
    db.pushOutbox.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await deliverPush(1, { send: ok, now: NOW })).toBe("not_claimed");
    db.pushOutbox.findUnique.mockResolvedValueOnce(row({ sentAt: NOW }));
    expect(await deliverPush(1, { send: ok, now: NOW })).toBe("not_claimed");
    db.pushOutbox.findUnique.mockResolvedValueOnce(row({ attempts: 3 }));
    expect(await deliverPush(1, { send: ok, now: NOW })).toBe("not_claimed");
    expect(ok).not.toHaveBeenCalled();
  });

  it("skips while the receiver is looking at that room; a stale mark does not count", async () => {
    db.chatPresence.findUnique.mockResolvedValueOnce({ seenAt: new Date(NOW.getTime() - 10_000) });
    expect(await deliverPush(1, { send: ok, now: NOW })).toBe("skipped");
    expect(db.pushOutbox.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { skipped: "viewing" } });
    db.chatPresence.findUnique.mockResolvedValueOnce({ seenAt: new Date(NOW.getTime() - PRESENCE_FRESH_MS - 1) });
    expect(await deliverPush(1, { send: ok, now: NOW })).toBe("sent");
  });

  it("never pushes for organization rooms, outsiders, the sender, hidden messages or withdrawn receivers", async () => {
    db.chatRoom.findUnique.mockResolvedValueOnce({ organizationId: 4, initiatorUserId: 10, counterpartUserId: null });
    expect(await deliverPush(1, { send: ok, now: NOW })).toBe("skipped");
    db.pushOutbox.findUnique.mockResolvedValueOnce(row({ userId: 10 }));
    expect(await deliverPush(1, { send: ok, now: NOW })).toBe("skipped");
    db.pushOutbox.findUnique.mockResolvedValueOnce(row({ message: { chatRoomId: 7, senderUserId: 10, hiddenAt: NOW } }));
    expect(await deliverPush(1, { send: ok, now: NOW })).toBe("skipped");
    db.user.findUnique.mockResolvedValueOnce({ withdrawnAt: NOW });
    expect(await deliverPush(1, { send: ok, now: NOW })).toBe("skipped");
    expect(ok).not.toHaveBeenCalled();
  });

  it("an expired subscription (404/410) is removed; others still get it", async () => {
    const send = vi.fn(async (s: { endpoint: string }) => {
      if (s.endpoint.endsWith("/a")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      return { statusCode: 201 };
    });
    expect(await deliverPush(1, { send, now: NOW })).toBe("sent");
    expect(db.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: 100 } });
  });

  it("network / 5xx failures leave the row for a retry; all-expired is closed", async () => {
    const down = vi.fn(async () => { throw Object.assign(new Error("down"), { statusCode: 503 }); });
    expect(await deliverPush(1, { send: down, now: NOW })).toBe("retry");
    expect(db.pushOutbox.update).toHaveBeenLastCalledWith({ where: { id: 1 }, data: { lastError: "status 503" } });
    const gone = vi.fn(async () => { throw Object.assign(new Error("gone"), { statusCode: 404 }); });
    expect(await deliverPush(1, { send: gone, now: NOW })).toBe("skipped");
  });

  it("the error kept never contains the endpoint", async () => {
    const down = vi.fn(async () => { throw Object.assign(new Error("https://push.example/a failed"), { statusCode: 500 }); });
    await deliverPush(1, { send: down, now: NOW });
    expect(JSON.stringify(db.pushOutbox.update.mock.calls)).not.toContain("push.example");
  });

  it("sweep retries recent unsent rows only", async () => {
    db.pushOutbox.findMany.mockResolvedValueOnce([{ id: 1 }]);
    expect(await sweepPendingPushes(5, { send: ok, now: NOW })).toBe(1);
    const where = db.pushOutbox.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ sentAt: null, skipped: null, attempts: { lt: 3 } });
    expect(where.createdAt.gte.getTime()).toBe(NOW.getTime() - 15 * 60_000);
    // a push that just failed is not hammered: only rows at least 15 s old
    expect(where.createdAt.lte.getTime()).toBe(NOW.getTime() - PUSH_SWEEP_MIN_AGE_MS);
  });

  it("a temporary failure is tried once more after a short wait, then left for later activity", async () => {
    const down = vi.fn(async () => { throw Object.assign(new Error("down"), { statusCode: 503 }); });
    const wait = vi.fn(async () => {});
    db.pushOutbox.findUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ attempts: 1 }));
    expect(await deliverWithRetry(1, { send: down, wait, now: () => NOW })).toBe("retry");
    expect(wait).toHaveBeenCalledWith(PUSH_RETRY_DELAY_MS);
    expect(down).toHaveBeenCalledTimes(4); // 2 devices x 2 tries
    // success on the first try never waits
    wait.mockClear();
    expect(await deliverWithRetry(1, { send: ok, wait, now: () => NOW })).toBe("sent");
    expect(wait).not.toHaveBeenCalled();
  });
});

describe("validSubscription", () => {
  it("accepts an https endpoint with base64url keys; rejects anything else", () => {
    expect(validSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "BAbc_-", auth: "xyz" } })).toBeTruthy();
    expect(validSubscription({ endpoint: "http://x", keys: { p256dh: "a", auth: "b" } })).toBeNull();
    expect(validSubscription({ endpoint: "https://x", keys: { p256dh: "a b", auth: "b" } })).toBeNull();
    expect(validSubscription({ endpoint: "https://x" })).toBeNull();
    expect(validSubscription("x")).toBeNull();
  });
});

describe("pushEnvironment", () => {
  const base = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, standalone: false, permission: "default" as const };
  it("in-app browsers and iPhone Safari tabs are guided, never asked", () => {
    expect(pushEnvironment({ ...base, userAgent: "Mozilla/5.0 (Linux; Android 14) KAKAOTALK 10.9" }).kind).toBe("in_app");
    expect(pushEnvironment({ ...base, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148 Safari/604.1" }).kind).toBe("ios_tab");
    expect(pushEnvironment({ ...base, standalone: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148" }).kind).toBe("ready");
  });
  it("Android Chrome is ready; a denied permission is never asked again; no API = unsupported", () => {
    const chrome = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
    expect(pushEnvironment({ ...base, userAgent: chrome }).kind).toBe("ready");
    expect(pushEnvironment({ ...base, userAgent: chrome, permission: "denied" }).kind).toBe("denied");
    expect(pushEnvironment({ ...base, userAgent: chrome, hasPushManager: false }).kind).toBe("unsupported");
  });
});
