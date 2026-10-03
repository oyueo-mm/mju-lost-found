import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";

// Per-user (or, for anonymous callers, per-IP) request limits on the
// endpoints where abuse costs the most: AI search (embedding models run in
// our functions), image uploads (Storage), post creation (+ embeddings),
// chat messages and reports. Counters live in Postgres
// (RateLimitCounter), so every serverless instance shares them -- never
// in process memory. Fixed windows; each action has a short burst window
// and a daily cap. The numbers are well above what a person using the
// service normally does.
export type RateLimitRule = { windowSeconds: number; max: number };

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const RATE_LIMITS = {
  aiSearch: {
    user: [
      { windowSeconds: MINUTE, max: 20 },
      { windowSeconds: DAY, max: 300 },
    ],
    anonymous: [
      { windowSeconds: MINUTE, max: 10 },
      { windowSeconds: DAY, max: 100 },
    ],
  },
  imageUpload: {
    user: [
      { windowSeconds: 10 * MINUTE, max: 30 },
      { windowSeconds: DAY, max: 200 },
    ],
  },
  postCreate: {
    user: [
      { windowSeconds: HOUR, max: 10 },
      { windowSeconds: DAY, max: 30 },
    ],
  },
  chatMessage: {
    user: [
      { windowSeconds: MINUTE, max: 30 },
      { windowSeconds: DAY, max: 1000 },
    ],
  },
  reportCreate: {
    user: [
      { windowSeconds: HOUR, max: 10 },
      { windowSeconds: DAY, max: 30 },
    ],
  },
} as const satisfies Record<string, { user: readonly RateLimitRule[]; anonymous?: readonly RateLimitRule[] }>;

export type RateLimitAction = keyof typeof RATE_LIMITS;
export type RateLimitSubject = { userId: number } | { ip: string | null };
export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

// An anonymous caller is identified by a salted hash of their IP -- the raw
// address is never stored.
function subjectKey(subject: RateLimitSubject): string {
  if ("userId" in subject) return `u:${subject.userId}`;
  const salt = process.env.AUTH_SECRET ?? "";
  const hash = createHash("sha256").update(`${salt}:${subject.ip ?? "unknown"}`).digest("hex").slice(0, 32);
  return `ip:${hash}`;
}

// The first address Vercel records for the request (x-forwarded-for is
// set by Vercel's edge, not trusted from further upstream).
export function clientIpFrom(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return headers.get("x-real-ip");
}

const PRUNE_PROBABILITY = 0.01;

export async function checkRateLimit(action: RateLimitAction, subject: RateLimitSubject): Promise<RateLimitResult> {
  const limits = RATE_LIMITS[action] as { user: readonly RateLimitRule[]; anonymous?: readonly RateLimitRule[] };
  const rules = "userId" in subject ? limits.user : limits.anonymous;
  if (!rules) return { ok: true };

  const now = Date.now();
  const who = subjectKey(subject);
  let retryAfterSeconds = 0;
  try {
    for (const rule of rules) {
      const windowMs = rule.windowSeconds * 1000;
      const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
      const key = `${action}:${who}:${rule.windowSeconds}`;
      // One atomic statement per window -- concurrent requests from any
      // instance each get their own, strictly increasing count.
      const rows = await prisma.$queryRaw<{ count: number }[]>`
        INSERT INTO "RateLimitCounter" ("key", "window_start", "count")
        VALUES (${key}, ${windowStart}, 1)
        ON CONFLICT ("key", "window_start") DO UPDATE SET "count" = "RateLimitCounter"."count" + 1
        RETURNING "count"
      `;
      if ((rows[0]?.count ?? 0) > rule.max) {
        retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((windowStart.getTime() + windowMs - now) / 1000));
      }
    }
    if (Math.random() < PRUNE_PROBABILITY) {
      await prisma.$executeRaw`DELETE FROM "RateLimitCounter" WHERE "window_start" < now() - interval '2 days'`;
    }
  } catch (error) {
    // A broken limiter must not take the feature down with it.
    console.error("Rate limit check failed (allowing the request):", error);
    return { ok: true };
  }
  return retryAfterSeconds > 0 ? { ok: false, retryAfterSeconds } : { ok: true };
}

function waitText(seconds: number): string {
  if (seconds < 60) return `${seconds}초`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}분`;
  return `${Math.ceil(seconds / 3600)}시간`;
}

// 429 in the same `{ error }` shape every other API error uses.
export function rateLimitedResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: `요청이 너무 많습니다. ${waitText(retryAfterSeconds)} 후에 다시 시도해주세요.` },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

// Convenience for route handlers: null when allowed, a 429 response
// otherwise.
export async function enforceRateLimit(action: RateLimitAction, subject: RateLimitSubject): Promise<NextResponse | null> {
  const result = await checkRateLimit(action, subject);
  return result.ok ? null : rateLimitedResponse(result.retryAfterSeconds);
}
