import { beforeEach, describe, expect, it, vi } from "vitest";

const $queryRaw = vi.fn();
const $executeRaw = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw, $executeRaw } }));

const { RATE_LIMITS, checkRateLimit, clientIpFrom, enforceRateLimit } = await import("./index");

// $queryRaw is a tagged template: [strings, ...values] -- values are key,
// windowStart.
const keysCalled = () => $queryRaw.mock.calls.map((call) => call[1] as string);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0.5); // no pruning unless a test asks for it
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("checkRateLimit", () => {
  it("allows a request under every window and counts it once per window, keyed by user id", async () => {
    $queryRaw.mockResolvedValue([{ count: 1 }]);

    expect(await checkRateLimit("chatMessage", { userId: 7 })).toEqual({ ok: true });
    expect(keysCalled()).toEqual(["chatMessage:u:7:60", "chatMessage:u:7:86400"]);
  });

  it("refuses once any window is over its limit, with the time until that window resets", async () => {
    const max = RATE_LIMITS.chatMessage.user[0].max;
    $queryRaw.mockResolvedValueOnce([{ count: max + 1 }]).mockResolvedValueOnce([{ count: 5 }]);

    const result = await checkRateLimit("chatMessage", { userId: 7 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it("allows exactly the limit", async () => {
    $queryRaw.mockResolvedValue([{ count: RATE_LIMITS.postCreate.user[0].max }]);
    expect((await checkRateLimit("postCreate", { userId: 1 })).ok).toBe(true);
  });

  it("keys anonymous callers by a salted IP hash, never the raw address", async () => {
    $queryRaw.mockResolvedValue([{ count: 1 }]);

    await checkRateLimit("aiSearch", { ip: "203.0.113.9" });

    const keys = keysCalled();
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).toMatch(/^aiSearch:ip:[0-9a-f]{32}:\d+$/);
      expect(key).not.toContain("203.0.113.9");
    }
  });

  it("has no anonymous limit for logged-in-only actions (those routes require a session anyway)", async () => {
    expect(await checkRateLimit("reportCreate", { ip: "203.0.113.9" })).toEqual({ ok: true });
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it("fails open (allows) if the counter table can't be reached", async () => {
    $queryRaw.mockRejectedValueOnce(new Error("db down"));
    expect(await checkRateLimit("aiSearch", { userId: 1 })).toEqual({ ok: true });
  });

  it("occasionally prunes counters older than two days", async () => {
    $queryRaw.mockResolvedValue([{ count: 1 }]);
    vi.spyOn(Math, "random").mockReturnValue(0.001);

    await checkRateLimit("imageUpload", { userId: 1 });

    expect($executeRaw).toHaveBeenCalledTimes(1);
  });
});

describe("enforceRateLimit", () => {
  it("returns a 429 with Retry-After and a Korean message when over the limit", async () => {
    $queryRaw.mockResolvedValue([{ count: 10_000 }]);

    const res = await enforceRateLimit("reportCreate", { userId: 3 });

    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res?.json()).error).toMatch(/요청이 너무 많습니다/);
  });

  it("returns null when allowed", async () => {
    $queryRaw.mockResolvedValue([{ count: 1 }]);
    expect(await enforceRateLimit("reportCreate", { userId: 3 })).toBeNull();
  });
});

describe("clientIpFrom", () => {
  it("takes the first x-forwarded-for address, falling back to x-real-ip", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientIpFrom(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIpFrom(new Headers())).toBeNull();
  });
});
