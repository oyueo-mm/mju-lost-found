import { createHash } from "node:crypto";
import { isIP } from "node:net";
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
  commentCreate: { user: [{ windowSeconds: MINUTE, max: 10 }, { windowSeconds: DAY, max: 100 }] },
  feedbackCreate: { user: [{ windowSeconds: HOUR, max: 5 }, { windowSeconds: DAY, max: 20 }] },
  // Preserve the one-note-per-return policy without reintroducing a daily cap.
  thankCreate: { user: [{ windowSeconds: MINUTE, max: 10 }] },
  keywordCreate: { user: [{ windowSeconds: MINUTE, max: 30 }, { windowSeconds: DAY, max: 100 }] },
} as const satisfies Record<
  string,
  { user: readonly RateLimitRule[]; anonymous?: readonly RateLimitRule[]; staff?: readonly RateLimitRule[] }
>;

export type RateLimitAction = keyof typeof RATE_LIMITS;
export type RateLimitTier = "user" | "staff";
// tier only matters for actions that define staff rules; everyone else
// (and every other action) uses the user rules.
export type RateLimitSubject = { userId: number; tier?: RateLimitTier } | { ip: string | null };
export type RateLimitResult = { ok: true } | { ok: false; reason: "limited" | "unavailable"; retryAfterSeconds: number };
export type RateLimitFailure = { kind: "rate_limited" | "rate_limit_unavailable"; retryAfterSeconds: number };

export function rateLimitFailure(result: RateLimitResult): RateLimitFailure | null {
  return result.ok ? null : { kind: result.reason === "unavailable" ? "rate_limit_unavailable" : "rate_limited", retryAfterSeconds: result.retryAfterSeconds };
}

export function rateLimitMessage(failure: RateLimitFailure): string {
  return failure.kind === "rate_limit_unavailable"
    ? "요청 제한 시스템에 일시적인 문제가 있습니다. 잠시 후 다시 시도해주세요."
    : `요청이 너무 많습니다. ${waitText(failure.retryAfterSeconds)} 후에 다시 시도해주세요.`;
}

export function rateLimitFailureResponse(failure: RateLimitFailure): NextResponse {
  if (failure.kind === "rate_limited") return rateLimitedResponse(failure.retryAfterSeconds);
  return NextResponse.json({ error: rateLimitMessage(failure), code: "RATE_LIMIT_UNAVAILABLE", retryAfterSeconds: failure.retryAfterSeconds }, { status: 503, headers: { "Retry-After": String(failure.retryAfterSeconds), "Cache-Control": "no-store" } });
}

// An anonymous caller is identified by a salted hash of their IP -- the raw
// address is never stored.
function subjectKey(subject: RateLimitSubject): string {
  if ("userId" in subject) return `u:${subject.userId}`;
  const salt = process.env.AUTH_SECRET ?? "";
  if (!salt) throw new Error("Anonymous rate limit hashing is not configured");
  const hash = createHash("sha256").update(`${salt}:${subject.ip ?? "unknown"}`).digest("hex").slice(0, 32);
  return `ip:${hash}`;
}

// The first address Vercel records for the request (x-forwarded-for is
// set by Vercel's edge, not trusted from further upstream).
export function clientIpFrom(headers: Headers, env: Record<string, string | undefined> = process.env): string | null {
  // Trust the platform only when running on Vercel, not a caller-provided
  // marker. Direct/self-hosted requests share the conservative unknown bucket.
  if (env.VERCEL !== "1") return null;
  const raw = headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for");
  if (!raw || raw.includes(",")) return null;
  const ip = raw.trim();
  if (!isIP(ip) || ip.includes("%")) return null;
  // Canonicalize equivalent IPv6 spellings (and mapped IPv4) before hashing.
  if (isIP(ip) === 4) return ip;
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (mapped) {
    const n = (parseInt(mapped[1], 16) * 65536) + parseInt(mapped[2], 16);
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  return canonical;
}

const PRUNE_PROBABILITY = 0.01;
class LimitExceeded extends Error {
  constructor(readonly seconds: number) { super("Rate limit exceeded"); }
}

export async function checkRateLimit(action: RateLimitAction, subject: RateLimitSubject): Promise<RateLimitResult> {
  const limits = RATE_LIMITS[action] as {
    user: readonly RateLimitRule[];
    anonymous?: readonly RateLimitRule[];
    staff?: readonly RateLimitRule[];
  };
  const rules = "userId" in subject ? (subject.tier === "staff" && limits.staff) || limits.user : limits.anonymous;
  if (!rules) return { ok: true };

  const now = Date.now();
  try {
    const who = subjectKey(subject);
    // All windows commit together. Throwing a quota decision rolls back the
    // entire request, including its daily charge. ON CONFLICT serializes
    // counters across processes; no application-memory locks are involved.
    await prisma.$transaction(async (tx) => {
      let retryAfterSeconds = 0;
      for (const rule of rules) {
        const windowMs = rule.windowSeconds * 1000;
        const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
        const key = `${action}:${who}:${rule.windowSeconds}`;
        // One atomic statement per window -- concurrent requests from any
        // instance each get their own, strictly increasing count.
        const rows = await tx.$queryRaw<{ count: number }[]>`
          INSERT INTO "RateLimitCounter" ("key", "window_start", "count")
          VALUES (${key}, ${windowStart}, 1)
          ON CONFLICT ("key", "window_start") DO UPDATE SET "count" = "RateLimitCounter"."count" + 1
          RETURNING "count"
        `;
        if (!rows[0] || !Number.isSafeInteger(rows[0].count)) throw new Error("Counter result missing");
        if (rows[0].count > rule.max) {
          retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((windowStart.getTime() + windowMs - now) / 1000));
        }
      }
      if (retryAfterSeconds > 0) throw new LimitExceeded(retryAfterSeconds);
    }, { maxWait: 2000, timeout: 3000 });
  } catch (error) {
    if (error instanceof LimitExceeded) return { ok: false, reason: "limited", retryAfterSeconds: error.seconds };
    console.error("Rate limit unavailable (request blocked):", error instanceof Error ? error.name : "unknown");
    return { ok: false, reason: "unavailable", retryAfterSeconds: 5 };
  }
  // Maintenance is separate from admission: failure cannot reverse a deny
  // or turn a committed admission into an ambiguous counter failure.
  try {
    if (Math.random() < PRUNE_PROBABILITY) {
      await prisma.$executeRaw`DELETE FROM "RateLimitCounter" WHERE "window_start" < now() - interval '2 days'`;
    }
  } catch (error) {
    console.error("Rate limit counter cleanup failed:", error instanceof Error ? error.name : "unknown");
  }
  return { ok: true };
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
    // Tier lookup never grants an elevated limit on failure. Admission
    // itself still fails closed if its counters cannot be reached.
    console.error("Rate limit tier lookup failed (using user limits):", error instanceof Error ? error.name : "unknown");
    return "user";
  }
}

// Route handlers: null when allowed, 429 on quota, 503 on counter failure.
export async function enforceRateLimit(action: RateLimitAction, subject: RateLimitSubject): Promise<NextResponse | null> {
  const result = await checkRateLimit(action, subject);
  if (result.ok) return null;
  return rateLimitFailureResponse(rateLimitFailure(result)!);
}
