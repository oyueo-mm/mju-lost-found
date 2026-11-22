import { beforeEach, describe, expect, it, vi } from "vitest";

const checkRateLimit = vi.fn();
const addDailyCount = vi.fn();
vi.mock("./index", async (importOriginal) => ({ ...(await importOriginal<typeof import("./index")>()), checkRateLimit }));
vi.mock("@/lib/metrics/record", () => ({ addDailyCount }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const { admitAiSearch, aiSearchDenialResponse } = await import("./aiSearch");
const ok = { ok: true };
const limited = { ok: false, reason: "limited", retryAfterSeconds: 30 };

beforeEach(() => {
  checkRateLimit.mockReset();
  addDailyCount.mockReset();
});

describe("admitAiSearch (A-4)", () => {
  it("charges an anonymous visitor to its network, then the anonymous and service ceilings", async () => {
    checkRateLimit.mockResolvedValue(ok);
    expect(await admitAiSearch(null, "2001:db8::1")).toEqual({ ok: true });
    expect(checkRateLimit.mock.calls).toEqual([
      ["aiSearch", { ip: "2001:db8::1" }],
      ["aiSearchAnonymousGlobal", { global: true }],
      ["aiSearchGlobal", { global: true }],
    ]);
    expect(addDailyCount).toHaveBeenCalledWith("ai_search.admitted.anon");
  });

  it("never charges a member to the anonymous ceiling", async () => {
    checkRateLimit.mockResolvedValue(ok);
    await admitAiSearch({ id: 7 }, "198.51.100.1");
    expect(checkRateLimit.mock.calls).toEqual([
      ["aiSearch", { userId: 7 }],
      ["aiSearchGlobal", { global: true }],
    ]);
  });

  it("does not spend the shared ceilings on a caller already over its own budget", async () => {
    checkRateLimit.mockResolvedValueOnce(limited);
    const admission = await admitAiSearch(null, "198.51.100.1");
    expect(admission).toMatchObject({ ok: false, denial: "self" });
    expect(checkRateLimit).toHaveBeenCalledOnce();
    expect(addDailyCount).toHaveBeenCalledWith("ai_search.limited.anon.self");
  });

  it("refuses anonymous search at the anonymous ceiling with a sign-in hint (429, AI_SEARCH_BUSY)", async () => {
    checkRateLimit.mockResolvedValueOnce(ok).mockResolvedValueOnce(limited);
    const admission = await admitAiSearch(null, "198.51.100.1");
    expect(admission).toMatchObject({ ok: false, denial: "anon_global" });
    expect(addDailyCount).toHaveBeenCalledWith("ai_search.limited.anon.anon_global");
    const res = aiSearchDenialResponse(admission as never);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("AI_SEARCH_BUSY");
    expect(body.error).toContain("로그인하면");
  });

  it("refuses a member at the service ceiling", async () => {
    checkRateLimit.mockResolvedValueOnce(ok).mockResolvedValueOnce(limited);
    const admission = await admitAiSearch({ id: 7 }, null);
    expect(admission).toMatchObject({ ok: false, denial: "global" });
    expect(addDailyCount).toHaveBeenCalledWith("ai_search.limited.member.global");
    expect(aiSearchDenialResponse(admission as never).status).toBe(429);
  });

  it("fails closed with 503 when the counters are unreachable", async () => {
    checkRateLimit.mockResolvedValueOnce({ ok: false, reason: "unavailable", retryAfterSeconds: 5 });
    const admission = await admitAiSearch(null, null);
    expect(addDailyCount).toHaveBeenCalledWith("ai_search.unavailable.anon.self");
    expect(aiSearchDenialResponse(admission as never).status).toBe(503);
  });
});
