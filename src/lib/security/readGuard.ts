import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

import { clientIpFrom, networkKey } from "@/lib/rateLimit";

// Security audit A-5 (2026-11-22, revised the same day -- decision A): a
// cheap brake on floods of the public read paths (lists, search, post detail,
// comments) -- the pages and APIs anyone can call without signing in, each
// costing database queries.
//
// WHO is counted
//   - A signed-in member is counted per MEMBER. The member id comes only from
//     the Auth.js session cookie after it is decrypted and verified with
//     AUTH_SECRET (getToken: no database query, no Auth.js callback). A
//     cookie that does not decrypt -- forged, expired, from elsewhere -- is
//     simply "anonymous". So students who are signed in never share a budget
//     with the rest of a campus NAT, and a cookie's mere presence buys nothing.
//   - Everyone else is counted per NETWORK (IPv4 address / IPv6 /64).
//   - Prefetch requests are counted like any other: excluding them would be a
//     bypass (the header is client-controlled). Dynamic routes are not
//     prefetched by default, and the board's links set prefetch={false}.
//
// LIMITS (READ_LIMITS, per 60-second window)
//   - perMember 600: a member's own ceiling -- signed-in floods are bounded too;
//   - perAnonymousNetwork 600: shared by the anonymous people behind one address;
//   - anonymousPerInstance 3000: an instance under an abnormal anonymous
//     volume sheds anonymous reads first, so members keep working;
//   - signedInPerInstance 6000: the same ceiling for the sum of all members
//     (many accounts), far above normal use.
//
// SCOPE: these counters live in THIS instance's memory, never the database --
// a limiter that writes a row per read would double the load it bounds.
// Vercel reuses warm instances, so one source mostly meets the same counters,
// but they are not a service-wide limit: a widely distributed flood is the
// platform's job (Vercel Firewall / Attack Challenge Mode). The service-wide,
// database-backed limits are AI search's (rateLimit/aiSearch.ts, A-4).

export const READ_WINDOW_MS = 60_000;
export const READ_LIMITS = { perMember: 600, perAnonymousNetwork: 600, anonymousPerInstance: 3000, signedInPerInstance: 6000 } as const;
const MAX_TRACKED_KEYS = 20_000;

type Bucket = { start: number; count: number };
// One set of counters per process: Next bundles route handlers and pages
// separately, so module-level state would give pages and APIs separate
// budgets inside the same instance.
type GuardState = { keys: Map<string, Bucket>; anonymous: Bucket; signedIn: Bucket };
const STATE_KEY = Symbol.for("mju.readGuard.v2");
const shared = globalThis as unknown as Record<symbol, GuardState | undefined>;
const state: GuardState = (shared[STATE_KEY] ??= { keys: new Map(), anonymous: { start: 0, count: 0 }, signedIn: { start: 0, count: 0 } });
const keys = state.keys;

export type ReadSubject = { kind: "member"; userId: number } | { kind: "anonymous"; network: string };
export type ReadAdmission = { ok: true } | { ok: false; scope: "member" | "network" | "instance"; retryAfterSeconds: number };

function bump(bucket: Bucket | undefined, now: number): Bucket {
  const start = Math.floor(now / READ_WINDOW_MS) * READ_WINDOW_MS;
  if (!bucket || bucket.start !== start) return { start, count: 1 };
  bucket.count++;
  return bucket;
}

const retryAfter = (bucket: Bucket, now: number) => Math.max(1, Math.ceil((bucket.start + READ_WINDOW_MS - now) / 1000));

/** Pure decision on this instance's counters (exported for tests). */
export function admitRead(subject: ReadSubject, now = Date.now()): ReadAdmission {
  if (keys.size > MAX_TRACKED_KEYS) {
    const current = Math.floor(now / READ_WINDOW_MS) * READ_WINDOW_MS;
    for (const [key, bucket] of keys) if (bucket.start !== current) keys.delete(key);
    if (keys.size > MAX_TRACKED_KEYS) keys.clear();
  }
  const member = subject.kind === "member";
  const key = member ? `m:${subject.userId}` : `n:${subject.network}`;
  const bucket = bump(keys.get(key), now);
  keys.set(key, bucket);
  if (bucket.count > (member ? READ_LIMITS.perMember : READ_LIMITS.perAnonymousNetwork)) {
    return { ok: false, scope: member ? "member" : "network", retryAfterSeconds: retryAfter(bucket, now) };
  }
  if (member) {
    state.signedIn = bump(state.signedIn, now);
    if (state.signedIn.count > READ_LIMITS.signedInPerInstance) return { ok: false, scope: "instance", retryAfterSeconds: retryAfter(state.signedIn, now) };
  } else {
    state.anonymous = bump(state.anonymous, now);
    if (state.anonymous.count > READ_LIMITS.anonymousPerInstance) return { ok: false, scope: "instance", retryAfterSeconds: retryAfter(state.anonymous, now) };
  }
  return { ok: true };
}

/** Test hook: forget every counter. */
export function resetReadGuard(): void {
  keys.clear();
  state.anonymous = { start: 0, count: 0 };
  state.signedIn = { start: 0, count: 0 };
}

const SESSION_COOKIE = /(?:^|;\s*)(__Secure-)?authjs\.session-token(?:\.\d+)?=/;

/**
 * The verified member id of this request, or null. Decrypts the Auth.js
 * session cookie with AUTH_SECRET (no database, no callbacks); anything that
 * does not verify -- including a forged or expired cookie -- is null.
 */
export async function verifiedMemberId(headers: Headers, env: Record<string, string | undefined> = process.env): Promise<number | null> {
  const cookie = SESSION_COOKIE.exec(headers.get("cookie") ?? "");
  const secret = env.AUTH_SECRET;
  if (!cookie || !secret) return null;
  try {
    // Cookie only: a bearer header must not stand in for the browser session.
    const token = await getToken({ req: { headers: { cookie: headers.get("cookie") ?? "" } }, secret, secureCookie: Boolean(cookie[1]), logger: { error() {}, warn() {}, debug() {} } as never });
    const id = Number(token?.userId);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/** Admission for one public read, from the request's headers. Off outside Vercel (no trusted client address). */
export async function admitPublicRead(headers: Headers, env: Record<string, string | undefined> = process.env): Promise<ReadAdmission> {
  if (env.VERCEL !== "1") return { ok: true };
  const userId = await verifiedMemberId(headers, env);
  return admitRead(userId ? { kind: "member", userId } : { kind: "anonymous", network: networkKey(clientIpFrom(headers, env)) });
}

const BUSY_MESSAGE = "요청이 너무 많아 잠시 제한하고 있어요. 잠시 후 다시 시도해주세요.";

/** Route handlers: null when allowed, else a 429. */
export async function guardPublicReadApi(headers: Headers): Promise<NextResponse | null> {
  const admission = await admitPublicRead(headers);
  if (admission.ok) return null;
  return NextResponse.json(
    { error: BUSY_MESSAGE, code: "READ_BUSY", retryAfterSeconds: admission.retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(admission.retryAfterSeconds), "Cache-Control": "no-store" } },
  );
}
