import { encode } from "next-auth/jwt";
import { beforeEach, describe, expect, it } from "vitest";

import { READ_LIMITS, READ_WINDOW_MS, admitPublicRead, admitRead, guardPublicReadApi, resetReadGuard, verifiedMemberId } from "./readGuard";

const T0 = 1_800_000_000_000; // a window boundary
const SECRET = "test-secret-for-read-guard-0123456789abcdef";
const COOKIE = "__Secure-authjs.session-token";
const sessionCookie = async (userId: number, secret = SECRET) =>
  `${COOKIE}=${await encode({ token: { userId, sub: String(userId) }, secret, salt: COOKIE })}`;
const anon = (network: string) => ({ kind: "anonymous" as const, network });
const member = (userId: number) => ({ kind: "member" as const, userId });
beforeEach(() => resetReadGuard());

describe("admitRead (A-5)", () => {
  it("allows an anonymous network up to its per-minute limit, then refuses with the real wait", () => {
    for (let i = 0; i < READ_LIMITS.perAnonymousNetwork; i++) expect(admitRead(anon("198.51.100.1"), T0 + 1000).ok).toBe(true);
    expect(admitRead(anon("198.51.100.1"), T0 + 20_000)).toEqual({ ok: false, scope: "network", retryAfterSeconds: 40 });
    // another network is unaffected, and the next window starts fresh
    expect(admitRead(anon("198.51.100.2"), T0 + 20_000).ok).toBe(true);
    expect(admitRead(anon("198.51.100.1"), T0 + READ_WINDOW_MS).ok).toBe(true);
  });

  it("counts members per member: a campus NAT's anonymous budget does not touch them, and a member's flood is bounded", () => {
    for (let i = 0; i < READ_LIMITS.perAnonymousNetwork + 1; i++) admitRead(anon("203.0.113.7"), T0);
    for (let id = 1; id <= 40; id++) expect(admitRead(member(id), T0).ok).toBe(true);
    for (let i = 1; i < READ_LIMITS.perMember; i++) expect(admitRead(member(1), T0).ok).toBe(true);
    expect(admitRead(member(1), T0)).toMatchObject({ ok: false, scope: "member" });
    expect(admitRead(member(2), T0).ok).toBe(true);
  });

  it("sheds anonymous reads past the instance limit but keeps signed-in members working", () => {
    for (let i = 0; i < READ_LIMITS.anonymousPerInstance; i++) expect(admitRead(anon(`net-${i % 1000}`), T0).ok).toBe(true);
    expect(admitRead(anon("net-new"), T0)).toMatchObject({ ok: false, scope: "instance" });
    expect(admitRead(member(5), T0).ok).toBe(true);
  });

  it("bounds the sum of all members on an instance too (many accounts)", () => {
    for (let i = 0; i < READ_LIMITS.signedInPerInstance; i++) expect(admitRead(member(1 + (i % 100)), T0).ok).toBe(true);
    expect(admitRead(member(999), T0)).toMatchObject({ ok: false, scope: "instance" });
    expect(admitRead(anon("198.51.100.3"), T0).ok).toBe(true);
  });
});

describe("verifiedMemberId (A-5: only a verified session counts as a member)", () => {
  it("returns the member id of a genuine Auth.js session cookie", async () => {
    expect(await verifiedMemberId(new Headers({ cookie: `theme=dark; ${await sessionCookie(42)}` }), { AUTH_SECRET: SECRET })).toBe(42);
  });

  it("treats a forged, foreign-secret or missing cookie as anonymous", async () => {
    const env = { AUTH_SECRET: SECRET };
    expect(await verifiedMemberId(new Headers({ cookie: `${COOKIE}=abc` }), env)).toBeNull();
    expect(await verifiedMemberId(new Headers({ cookie: await sessionCookie(42, "another-secret-0123456789abcdef-xyz") }), env)).toBeNull();
    expect(await verifiedMemberId(new Headers(), env)).toBeNull();
    expect(await verifiedMemberId(new Headers({ cookie: await sessionCookie(42) }), {})).toBeNull();
  });

  it("ignores a bearer header standing in for the session cookie", async () => {
    const token = (await sessionCookie(42)).split("=").slice(1).join("=");
    expect(await verifiedMemberId(new Headers({ authorization: `Bearer ${token}` }), { AUTH_SECRET: SECRET })).toBeNull();
  });
});

describe("admitPublicRead (A-5)", () => {
  const vercel = { VERCEL: "1", AUTH_SECRET: SECRET };
  it("is off outside Vercel (no trusted client address)", async () => {
    for (let i = 0; i < READ_LIMITS.perAnonymousNetwork + 5; i++) expect((await admitPublicRead(new Headers(), {})).ok).toBe(true);
  });

  it("counts every address of one IPv6 /64 together", async () => {
    for (let i = 0; i < READ_LIMITS.perAnonymousNetwork; i++) {
      await admitPublicRead(new Headers({ "x-vercel-forwarded-for": `2001:db8:1:2::${(i % 65535).toString(16)}` }), vercel);
    }
    expect((await admitPublicRead(new Headers({ "x-vercel-forwarded-for": "2001:db8:1:2:ffff::1" }), vercel)).ok).toBe(false);
    expect((await admitPublicRead(new Headers({ "x-vercel-forwarded-for": "2001:db8:1:3::1" }), vercel)).ok).toBe(true);
  });

  it("a forged session cookie is anonymous: no escape from the network limit or the instance shedding", async () => {
    const forged = new Headers({ "x-vercel-forwarded-for": "203.0.113.5", cookie: `theme=dark; ${COOKIE}=abc` });
    for (let i = 0; i < READ_LIMITS.perAnonymousNetwork; i++) expect((await admitPublicRead(forged, vercel)).ok).toBe(true);
    expect(await admitPublicRead(forged, vercel)).toMatchObject({ ok: false, scope: "network" });
    resetReadGuard();
    for (let i = 0; i < READ_LIMITS.anonymousPerInstance; i++) admitRead(anon(`n${i % 2000}`));
    expect((await admitPublicRead(forged, vercel)).ok).toBe(false);
  });

  it("a genuine member behind an exhausted campus address keeps reading", async () => {
    const campus = "203.0.113.9";
    for (let i = 0; i < READ_LIMITS.perAnonymousNetwork + 1; i++) await admitPublicRead(new Headers({ "x-vercel-forwarded-for": campus }), vercel);
    const signedIn = new Headers({ "x-vercel-forwarded-for": campus, cookie: await sessionCookie(7) });
    expect((await admitPublicRead(signedIn, vercel)).ok).toBe(true);
  });
});

describe("guardPublicReadApi (A-5)", () => {
  it("answers 429 with Retry-After and no-store once over the limit", async () => {
    const prev = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      const h = new Headers({ "x-vercel-forwarded-for": "192.0.2.9" });
      for (let i = 0; i < READ_LIMITS.perAnonymousNetwork; i++) expect(await guardPublicReadApi(h)).toBeNull();
      const res = (await guardPublicReadApi(h))!;
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
