import { beforeEach, describe, expect, it, vi } from "vitest";

const $queryRaw = vi.fn();
const $executeRaw = vi.fn();
const organizationMember = { count: vi.fn() };
vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw, $executeRaw, organizationMember } }));

const { RATE_LIMITS, checkRateLimit, clientIpFrom, enforceRateLimit, rateLimitTierFor, waitText } = await import("./index");

const DAY_SECONDS = 24 * 60 * 60;

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

  it("gives staff higher image-upload and post limits, but not other actions", async () => {
    const userMax = RATE_LIMITS.imageUpload.user[0].max;
    $queryRaw.mockResolvedValue([{ count: userMax + 1 }]);

    expect((await checkRateLimit("imageUpload", { userId: 1 })).ok).toBe(false);
    expect((await checkRateLimit("imageUpload", { userId: 1, tier: "staff" })).ok).toBe(true);
    // same counter keys either way -- the tier only changes the ceiling
    expect(new Set(keysCalled())).toEqual(new Set(["imageUpload:u:1:600", "imageUpload:u:1:86400"]));

    $queryRaw.mockResolvedValue([{ count: RATE_LIMITS.postCreate.user[0].max + 1 }]);
    expect((await checkRateLimit("postCreate", { userId: 1, tier: "staff" })).ok).toBe(true);
    $queryRaw.mockResolvedValue([{ count: RATE_LIMITS.chatMessage.user[0].max + 1 }]);
    expect((await checkRateLimit("chatMessage", { userId: 1, tier: "staff" })).ok).toBe(false);

    // staff is still bounded
    $queryRaw.mockResolvedValue([{ count: RATE_LIMITS.imageUpload.staff[0].max + 1 }]);
    expect((await checkRateLimit("imageUpload", { userId: 1, tier: "staff" })).ok).toBe(false);
  });

  it("gives a rejected request's count back in every window, so retries don't extend the block", async () => {
    const max = RATE_LIMITS.postCreate.user[0].max;
    $queryRaw.mockResolvedValueOnce([{ count: max + 1 }]).mockResolvedValueOnce([{ count: 12 }]);

    const result = await checkRateLimit("postCreate", { userId: 4 });

    expect(result.ok).toBe(false);
    // one decrement per window (hour + day), keyed like the increment
    expect($executeRaw).toHaveBeenCalledTimes(2);
    const decremented = $executeRaw.mock.calls.map((call) => call[1]);
    expect(decremented).toEqual(["postCreate:u:4:3600", "postCreate:u:4:86400"]);
    expect(($executeRaw.mock.calls[0][0] as string[]).join("?")).toMatch(/"count" - 1/);
  });

  it("doesn't decrement anything when the request is allowed", async () => {
    $queryRaw.mockResolvedValue([{ count: 3 }]);
    await checkRateLimit("postCreate", { userId: 4 });
    expect($executeRaw).not.toHaveBeenCalled();
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

  it("includes the exact remaining wait for the client (seconds and the time it ends)", async () => {
    $queryRaw.mockResolvedValue([{ count: 10_000 }]);

    const res = await enforceRateLimit("imageUpload", { userId: 3 });
    const body = await res?.json();

    expect(body.retryAfterSeconds).toBe(Number(res?.headers.get("retry-after")));
    expect(body.retryAfterSeconds).toBeLessThanOrEqual(DAY_SECONDS);
    expect(Date.parse(body.retryAt)).toBeGreaterThan(Date.now());
    expect(body.error).toContain(waitText(body.retryAfterSeconds));
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

describe("waitText", () => {
  it("states the real remaining wait instead of a rounded bucket", () => {
    expect(waitText(45)).toBe("45초");
    expect(waitText(60)).toBe("1분");
    expect(waitText(250)).toBe("4분 10초");
    expect(waitText(3600)).toBe("1시간");
    expect(waitText(3900)).toBe("1시간 5분");
    expect(waitText(7170)).toBe("2시간");
  });
});

describe("rateLimitTierFor", () => {
  it("treats admins and approved external staff as staff without a lookup", async () => {
    expect(await rateLimitTierFor({ id: 1, isAdmin: true, userType: "STUDENT" })).toBe("staff");
    expect(await rateLimitTierFor({ id: 2, isAdmin: false, userType: "EXTERNAL_VERIFIED" })).toBe("staff");
    expect(organizationMember.count).not.toHaveBeenCalled();
  });

  it("treats a leader/admin of an active organization as staff, everyone else as a user", async () => {
    organizationMember.count.mockResolvedValueOnce(1);
    expect(await rateLimitTierFor({ id: 3, isAdmin: false, userType: "STUDENT" })).toBe("staff");
    expect(organizationMember.count).toHaveBeenCalledWith({
      where: { userId: 3, role: { in: ["LEADER", "ADMIN"] }, organization: { status: "ACTIVE" } },
    });

    organizationMember.count.mockResolvedValueOnce(0);
    expect(await rateLimitTierFor({ id: 4, isAdmin: false, userType: "STUDENT" })).toBe("user");
  });

  it("falls back to user limits if the lookup fails", async () => {
    organizationMember.count.mockRejectedValueOnce(new Error("db down"));
    expect(await rateLimitTierFor({ id: 5, isAdmin: false, userType: "STUDENT" })).toBe("user");
  });
});
