import { NextResponse } from "next/server";

import { clientIpFrom, networkKey } from "@/lib/rateLimit";

// Security audit A-5 (2026-11-22): a cheap brake on floods of the public
// read paths (lists, search, post detail, comments) -- the pages and APIs
// anyone can call without signing in, each costing database queries.
//
// Deliberately in this instance's memory, never the database: a limiter that
// writes a counter row per read would double the very load it is meant to
// bound. So it is per instance -- Vercel keeps reusing warm instances, so a
// single source mostly meets the same counters, but a widely distributed
// flood is the platform's job (Vercel Firewall / Attack Challenge Mode, see
// docs/operations/security-hardening-2026-11-22.md). Two limits:
//   - per network (IPv4 address / IPv6 /64), everyone counted: generous,
//     because a campus NAT puts many students behind one address;
//   - per instance, requests without a session cookie: once an instance is
//     serving an abnormal anonymous volume it sheds anonymous reads first,
//     so signed-in students keep working. (A forged cookie only skips this
//     shedding, never the per-network limit.)
// AI search has its own, database-backed limits (rateLimit/aiSearch.ts).

export const READ_WINDOW_MS = 60_000;
export const READ_LIMITS = { perNetwork: 600, anonymousPerInstance: 3000 } as const;
const MAX_TRACKED_NETWORKS = 20_000;

type Bucket = { start: number; count: number };
// One set of counters per process: Next bundles route handlers and pages
// separately, so module-level state would give pages and APIs separate
// budgets inside the same instance.
type GuardState = { networks: Map<string, Bucket>; anonymous: Bucket };
const STATE_KEY = Symbol.for("mju.readGuard.v1");
const shared = globalThis as unknown as Record<symbol, GuardState | undefined>;
const state: GuardState = (shared[STATE_KEY] ??= { networks: new Map(), anonymous: { start: 0, count: 0 } });
const networks = state.networks;

export type ReadAdmission = { ok: true } | { ok: false; scope: "network" | "instance"; retryAfterSeconds: number };

function bump(bucket: Bucket | undefined, now: number): Bucket {
  const start = Math.floor(now / READ_WINDOW_MS) * READ_WINDOW_MS;
  if (!bucket || bucket.start !== start) return { start, count: 1 };
  bucket.count++;
  return bucket;
}

const retryAfter = (bucket: Bucket, now: number) => Math.max(1, Math.ceil((bucket.start + READ_WINDOW_MS - now) / 1000));

/** Pure decision on this instance's counters (exported for tests). */
export function admitRead(network: string, signedIn: boolean, now = Date.now()): ReadAdmission {
  if (networks.size > MAX_TRACKED_NETWORKS) {
    const current = Math.floor(now / READ_WINDOW_MS) * READ_WINDOW_MS;
    for (const [key, bucket] of networks) if (bucket.start !== current) networks.delete(key);
    if (networks.size > MAX_TRACKED_NETWORKS) networks.clear();
  }
  const bucket = bump(networks.get(network), now);
  networks.set(network, bucket);
  if (bucket.count > READ_LIMITS.perNetwork) return { ok: false, scope: "network", retryAfterSeconds: retryAfter(bucket, now) };
  if (!signedIn) {
    state.anonymous = bump(state.anonymous, now);
    if (state.anonymous.count > READ_LIMITS.anonymousPerInstance) return { ok: false, scope: "instance", retryAfterSeconds: retryAfter(state.anonymous, now) };
  }
  return { ok: true };
}

/** Test hook: forget every counter. */
export function resetReadGuard(): void {
  networks.clear();
  state.anonymous = { start: 0, count: 0 };
}

const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?authjs\.session-token(?:\.\d+)?=/;

/** Admission for one public read, from the request's headers. Off outside Vercel (no trusted client address). */
export function admitPublicRead(headers: Headers, env: Record<string, string | undefined> = process.env): ReadAdmission {
  if (env.VERCEL !== "1") return { ok: true };
  return admitRead(networkKey(clientIpFrom(headers, env)), SESSION_COOKIE.test(headers.get("cookie") ?? ""));
}

const BUSY_MESSAGE = "요청이 너무 많아 잠시 제한하고 있어요. 잠시 후 다시 시도해주세요.";

/** Route handlers: null when allowed, else a 429. */
export function guardPublicReadApi(headers: Headers): NextResponse | null {
  const admission = admitPublicRead(headers);
  if (admission.ok) return null;
  return NextResponse.json(
    { error: BUSY_MESSAGE, code: "READ_BUSY", retryAfterSeconds: admission.retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(admission.retryAfterSeconds), "Cache-Control": "no-store" } },
  );
}
