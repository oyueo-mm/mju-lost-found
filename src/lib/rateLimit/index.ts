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
    // Staff (see rateLimitTierFor) register found items in batches -- e.g.
    // a student-support office entering a day's drop-offs, several photos
    // each. Higher, still bounded.
    staff: [
      { windowSeconds: 10 * MINUTE, max: 150 },
      { windowSeconds: DAY, max: 1500 },
    ],
  },
  postCreate: {
    user: [
      { windowSeconds: HOUR, max: 10 },
      { windowSeconds: DAY, max: 30 },
    ],
    staff: [
      { windowSeconds: HOUR, max: 60 },
      { windowSeconds: DAY, max: 300 },
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
} as const satisfies Record<
  string,
  { user: readonly RateLimitRule[]; anonymous?: readonly RateLimitRule[]; staff?: readonly RateLimitRule[] }
>;

export type RateLimitAction = keyof typeof RATE_LIMITS;
export type RateLimitTier = "user" | "staff";
// tier only matters for actions that define staff rules; everyone else
// (and every other action) uses the user rules.
export type RateLimitSubject = { userId: number; tier?: RateLimitTier } | { ip: string | null };
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
  const limits = RATE_LIMITS[action] as {
    user: readonly RateLimitRule[];
    anonymous?: readonly RateLimitRule[];
    staff?: readonly RateLimitRule[];
  };
  const rules = "userId" in subject ? (subject.tier === "staff" && limits.staff) || limits.user : limits.anonymous;
  if (!rules) return { ok: true };

  const now = Date.now();
  const who = subjectKey(subject);
  let retryAfterSeconds = 0;
  const counted: { key: string; windowStart: Date }[] = [];
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
      counted.push({ key, windowStart });
      if ((rows[0]?.count ?? 0) > rule.max) {
        retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((windowStart.getTime() + windowMs - now) / 1000));
      }
    }
    // A rejected request must not use up quota. Before, every blocked
    // retry still counted -- including toward the daily window -- so a
    // user retrying during a short block could push the daily count over
    // its cap and stay blocked far past the wait the message announced.
    if (retryAfterSeconds > 0) {
      for (const { key, windowStart } of counted) {
        await prisma.$executeRaw`
          UPDATE "RateLimitCounter" SET "count" = "count" - 1
          WHERE "key" = ${key} AND "window_start" = ${windowStart} AND "count" > 0
        `;
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

// The actual remaining wait, not a rounded-up bucket: "4분 10초",
// "1시간 5분". Windows are fixed (they end on the window boundary), so this
// is exact.
export function waitText(seconds: number): string {
  if (seconds < 60) return `${seconds}초`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s === 0 ? `${m}분` : `${m}분 ${s}초`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.ceil((seconds % 3600) / 60);
  return m === 0 ? `${h}시간` : m === 60 ? `${h + 1}시간` : `${h}시간 ${m}분`;
}

// 429 in the same `{ error }` shape every other API error uses, plus
// retryAfterSeconds/retryAt so the client can show (and count down) the
// real wait in the viewer's own language.
export function rateLimitedResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    {
      error: `요청이 너무 많습니다. ${waitText(retryAfterSeconds)} 후에 다시 시도해주세요.`,
      retryAfterSeconds,
      retryAt: new Date(Date.now() + retryAfterSeconds * 1000).toISOString(),
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

// Staff: an admin, an admin-approved external account (e.g. building or
// lost-and-found office staff), or a leader/admin of an active
// organization. Everyone else is a regular user.
export async function rateLimitTierFor(user: { id: number; isAdmin: boolean; userType: string }): Promise<RateLimitTier> {
  if (user.isAdmin || user.userType === "EXTERNAL_VERIFIED") return "staff";
  try {
    const managed = await prisma.organizationMember.count({
      where: { userId: user.id, role: { in: ["LEADER", "ADMIN"] }, organization: { status: "ACTIVE" } },
    });
    return managed > 0 ? "staff" : "user";
  } catch (error) {
    // Same as the limiter itself: a lookup failure must not break the
    // request -- fall back to the regular (lower) limits.
    console.error("Rate limit tier lookup failed (using user limits):", error);
    return "user";
  }
}

// Convenience for route handlers: null when allowed, a 429 response
// otherwise.
export async function enforceRateLimit(action: RateLimitAction, subject: RateLimitSubject): Promise<NextResponse | null> {
  const result = await checkRateLimit(action, subject);
  return result.ok ? null : rateLimitedResponse(result.retryAfterSeconds);
}
