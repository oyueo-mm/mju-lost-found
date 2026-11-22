import { beforeEach, describe, expect, it } from "vitest";

import { READ_LIMITS, READ_WINDOW_MS, admitPublicRead, admitRead, guardPublicReadApi, resetReadGuard } from "./readGuard";

const T0 = 1_800_000_000_000; // a window boundary
beforeEach(() => resetReadGuard());

describe("admitRead (A-5)", () => {
  it("allows a network up to its per-minute limit, then refuses with the real wait", () => {
    for (let i = 0; i < READ_LIMITS.perNetwork; i++) expect(admitRead("198.51.100.1", true, T0 + 1000).ok).toBe(true);
    const refused = admitRead("198.51.100.1", true, T0 + 20_000);
    expect(refused).toEqual({ ok: false, scope: "network", retryAfterSeconds: 40 });
    // another network is unaffected, and the next window starts fresh
    expect(admitRead("198.51.100.2", true, T0 + 20_000).ok).toBe(true);
    expect(admitRead("198.51.100.1", true, T0 + READ_WINDOW_MS).ok).toBe(true);
  });

  it("sheds anonymous reads past the instance limit but keeps signed-in members working", () => {
    for (let i = 0; i < READ_LIMITS.anonymousPerInstance; i++) {
      expect(admitRead(`net-${i % 1000}`, false, T0).ok).toBe(true);
    }
    expect(admitRead("net-new", false, T0)).toMatchObject({ ok: false, scope: "instance" });
    expect(admitRead("net-new", true, T0).ok).toBe(true);
  });
});

describe("admitPublicRead (A-5)", () => {
  const vercel = { VERCEL: "1" };
  it("is off outside Vercel (no trusted client address)", () => {
    for (let i = 0; i < READ_LIMITS.perNetwork + 5; i++) expect(admitPublicRead(new Headers(), {}).ok).toBe(true);
  });

  it("counts every address of one IPv6 /64 together", () => {
    for (let i = 0; i < READ_LIMITS.perNetwork; i++) {
      admitPublicRead(new Headers({ "x-vercel-forwarded-for": `2001:db8:1:2::${(i % 65535).toString(16)}` }), vercel);
    }
    expect(admitPublicRead(new Headers({ "x-vercel-forwarded-for": "2001:db8:1:2:ffff::1" }), vercel).ok).toBe(false);
    expect(admitPublicRead(new Headers({ "x-vercel-forwarded-for": "2001:db8:1:3::1" }), vercel).ok).toBe(true);
  });

  it("treats a request with a session cookie as signed in (instance shedding only)", () => {
    for (let i = 0; i < READ_LIMITS.anonymousPerInstance; i++) admitRead(`n${i % 2000}`, false);
    const anon = new Headers({ "x-vercel-forwarded-for": "203.0.113.5" });
    const member = new Headers({ "x-vercel-forwarded-for": "203.0.113.5", cookie: "theme=dark; __Secure-authjs.session-token=abc" });
    expect(admitPublicRead(anon, vercel).ok).toBe(false);
    expect(admitPublicRead(member, vercel).ok).toBe(true);
  });
});

describe("guardPublicReadApi (A-5)", () => {
  it("answers 429 with Retry-After and no-store once over the limit", async () => {
    const prev = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      const h = new Headers({ "x-vercel-forwarded-for": "192.0.2.9" });
      for (let i = 0; i < READ_LIMITS.perNetwork; i++) expect(guardPublicReadApi(h)).toBeNull();
      const res = guardPublicReadApi(h)!;
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect((await res.json()).code).toBe("READ_BUSY");
    } finally {
      if (prev === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prev;
    }
  });
});
