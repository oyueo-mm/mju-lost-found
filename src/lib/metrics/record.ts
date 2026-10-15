import { createHmac } from "node:crypto";
import { after } from "next/server";

import { prisma } from "@/lib/db/prisma";

// 운영 통계 recording (admin dashboard, /admin/stats). Rules:
// - Only what the existing tables can't answer is recorded here: search
//   counts by kind, recommendations shown, active members, API timings.
// - No search text, no user id in the clear, no IP, no path ids.
// - Never on the request's critical path, never able to fail a request:
//   writes run after the response (next/server after()) and swallow errors
//   (a missing table -- e.g. before the migration -- just means no data).
// - Cheap: counters and API timings are aggregated in this instance's
//   memory; the first one schedules a single write after the response that
//   waits until FLUSH_EVERY_MS after the previous write (at least
//   FLUSH_MIN_DELAY_MS), so a quiet instance writes within seconds -- before
//   Vercel can recycle it -- and a busy one at most every 20 seconds.

export type DailyMetric =
  | "search.keyword"
  | "search.semantic"
  | "search.image"
  | "recommend.shown";

// Daily capacity snapshot (set, not added), written by the daily retention
// cron: database and Storage size in MB, to watch against the free limits.
export async function recordCapacity(): Promise<{ dbMb: number; storageMb: number } | null> {
  try {
    const [{ db_bytes, storage_bytes }] = await prisma.$queryRaw<{ db_bytes: bigint; storage_bytes: bigint | null }[]>`
      SELECT pg_database_size(current_database()) AS db_bytes,
             (SELECT sum((metadata->>'size')::bigint) FROM storage.objects) AS storage_bytes`;
    const dbMb = Math.round(Number(db_bytes) / 1048576);
    const storageMb = Math.round(Number(storage_bytes ?? 0) / 1048576);
    const day = kstDay();
    await prisma.$executeRaw`INSERT INTO "MetricDaily" ("day", "metric", "value") VALUES
      (${day}::date, 'capacity.db_mb', ${dbMb}), (${day}::date, 'capacity.storage_mb', ${storageMb})
      ON CONFLICT ("day", "metric") DO UPDATE SET "value" = EXCLUDED."value"`;
    return { dbMb, storageMb };
  } catch (error) {
    swallow(error);
    return null;
  }
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// "YYYY-MM-DD" of the KST calendar day.
export function kstDay(at: Date = new Date()): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

let warned = false;
function swallow(error: unknown) {
  if (warned) return;
  warned = true;
  console.error("Metrics write skipped:", error instanceof Error ? error.name : "unknown");
}

// Runs `task` after the response when inside a request, else right away.
function later(task: () => Promise<unknown>) {
  const run = () => task().catch(swallow);
  try {
    after(run);
  } catch {
    // Outside a request (scripts, tests): nothing keeps the process for a
    // deferred write, so the observation simply stays in memory.
    flushScheduled = false;
  }
}

// Same search seen again within a few seconds on this instance (a refresh,
// a double render, back/forward) is counted once.
const DEDUPE_MS = 10_000;
const recent = new Map<string, number>();
export function firstSeen(signature: string, now = Date.now()): boolean {
  for (const [key, at] of recent) {
    if (now - at > DEDUPE_MS) recent.delete(key);
    else break;
  }
  const last = recent.get(signature);
  if (last !== undefined && now - last <= DEDUPE_MS) return false;
  recent.delete(signature);
  recent.set(signature, now);
  if (recent.size > 1000) recent.delete(recent.keys().next().value as string);
  return true;
}

// The signature only ever lives in memory as a hash; the query is never stored.
function signatureOf(parts: unknown[]): string {
  return createHmac("sha256", "metrics-dedupe").update(JSON.stringify(parts)).digest("base64url");
}

// Counted in this instance's memory and written with the timings (at most
// once a minute), so a busy page never costs a DB write per view.
const pendingDaily = new Map<string, number>();
export function recordDaily(metric: DailyMetric, dedupeParts?: unknown[]): boolean {
  if (dedupeParts && !firstSeen(signatureOf([metric, ...dedupeParts]))) return false;
  addDailyCount(metric);
  // 방문 통계: a search is also counted by who made it -- "search.keyword"
  // stays the total, "search.keyword.anon|member|internal" splits the same
  // events (never added to the total). Resolved after this call, still
  // before the deferred write.
  if (metric.startsWith("search.")) void countByAudience(metric);
  return true;
}

// Adds to a per-day counter in the same batched write (방문 통계 uses its
// own "visit.*" names -- see lib/metrics/visits.ts and app/visitActions.ts).
export function addDailyCount(metric: string, n = 1): void {
  const key = `${kstDay()}|${metric}`;
  pendingDaily.set(key, (pendingDaily.get(key) ?? 0) + n);
  noteObservation();
}

// anon (signed out), member, or internal (an admin -- kept apart so staff
// testing never reads as visitor traffic).
export type Audience = "anon" | "member" | "internal";
export async function currentAudience(): Promise<Audience> {
  const { getCurrentUser } = await import("@/lib/auth/session");
  const user = await getCurrentUser();
  return !user ? "anon" : user.isAdmin ? "internal" : "member";
}

async function countByAudience(metric: string): Promise<void> {
  try {
    addDailyCount(`${metric}.${await currentAudience()}`);
  } catch {
    // Outside a request (scripts, tests) there is no session to read.
  }
}

// Active member: one row per member per KST day, keyed by an HMAC of the id.
export function activityActor(userId: number, secret = process.env.AUTH_SECRET ?? ""): string {
  return createHmac("sha256", `activity-day:v1:${secret}`).update(String(userId)).digest("base64url").slice(0, 22);
}

export async function recordActiveDay(userId: number): Promise<void> {
  const day = kstDay();
  try {
    await prisma.$executeRaw`INSERT INTO "ActivityDay" ("day", "actor") VALUES (${day}::date, ${activityActor(userId)})
      ON CONFLICT DO NOTHING`;
  } catch (error) {
    swallow(error);
  }
}

// ---------- API / AI / DB timings ----------

// Upper bounds (ms) of the latency histogram; the last bucket is open-ended.
export const LATENCY_BUCKETS_MS = [25, 50, 100, 200, 400, 800, 1600, 3200, 6400] as const;
const BUCKET_COUNT = LATENCY_BUCKETS_MS.length + 1;

export function bucketOf(ms: number): number {
  const i = LATENCY_BUCKETS_MS.findIndex((upper) => ms <= upper);
  return i === -1 ? LATENCY_BUCKETS_MS.length : i;
}

type Agg = { hour: string; route: string; count: number; errors: number; totalMs: number; buckets: number[] };
const pending = new Map<string, Agg>();
let lastFlush = 0;
const FLUSH_EVERY_MS = 20_000;
const FLUSH_MIN_DELAY_MS = 2_000;
let flushScheduled = false;

// UTC hour start, as the timestamp(3) column stores it.
function hourOf(at: Date): string {
  return `${at.toISOString().slice(0, 13)}:00:00.000`;
}

// Route label without ids: /api/posts/123/image -> /api/posts/[id]/image.
export function normalizeRoute(method: string, url: string | undefined): string {
  if (!url) return `${method} (unknown)`;
  let path = url;
  let mode: string | null = null;
  try {
    const parsed = new URL(url, "http://local");
    path = parsed.pathname;
    mode = parsed.searchParams.get("mode");
  } catch {
    // keep the raw path
  }
  const normalized = path
    .split("/")
    .map((segment) => (/^\d+$/.test(segment) || /^[0-9a-f-]{20,}$/i.test(segment) ? "[id]" : segment))
    .join("/");
  const withMode = normalized === "/api/posts" && mode && /^[a-z]{1,12}$/.test(mode) ? `${normalized}?mode=${mode}` : normalized;
  return `${method} ${withMode}`;
}

export function observeTiming(route: string, ms: number, failed = false, at = new Date()): void {
  const hour = hourOf(at);
  const key = `${hour}|${route}`;
  let agg = pending.get(key);
  if (!agg) {
    agg = { hour, route, count: 0, errors: 0, totalMs: 0, buckets: new Array(BUCKET_COUNT).fill(0) };
    pending.set(key, agg);
  }
  agg.count += 1;
  if (failed) agg.errors += 1;
  agg.totalMs += Math.max(0, Math.round(ms));
  agg.buckets[bucketOf(ms)] += 1;
  noteObservation();
}

function noteObservation() {
  if (flushScheduled) return;
  flushScheduled = true;
  const wait = Math.max(FLUSH_MIN_DELAY_MS, lastFlush + FLUSH_EVERY_MS - Date.now());
  later(async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, wait));
      await flushTimings();
    } finally {
      flushScheduled = false;
    }
  });
}

export async function flushTimings(): Promise<void> {
  if (pending.size === 0 && pendingDaily.size === 0) return;
  const rows = [...pending.values()];
  pending.clear();
  const daily = [...pendingDaily.entries()];
  pendingDaily.clear();
  lastFlush = Date.now();
  // DB latency, sampled once per flush (not per request).
  const t0 = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const ping = { hour: hourOf(new Date()), route: "db:ping", count: 1, errors: 0, totalMs: Math.round(performance.now() - t0), buckets: new Array(BUCKET_COUNT).fill(0) };
    ping.buckets[bucketOf(ping.totalMs)] = 1;
    rows.push(ping);
  } catch {
    // The write below will fail the same way and keep the batch for later.
  }
  // One statement per table, both in one transaction: a batch is written
  // whole or not at all. If it fails it goes back into memory and is retried
  // with the next batch (never written twice: nothing was committed).
  const dailyJson = JSON.stringify(daily.map(([key, n]) => ({ day: key.split("|")[0], metric: key.split("|")[1], value: n })));
  const rowsJson = JSON.stringify(rows.map((r) => ({ hour: r.hour, route: r.route, count: r.count, errors: r.errors, total_ms: r.totalMs, buckets: r.buckets })));
  try {
    await prisma.$transaction([
      prisma.$executeRaw`INSERT INTO "MetricDaily" ("day", "metric", "value")
        SELECT x.day, x.metric, x.value FROM json_to_recordset(${dailyJson}::json) AS x(day date, metric text, value int)
        ON CONFLICT ("day", "metric") DO UPDATE SET "value" = "MetricDaily"."value" + EXCLUDED."value"`,
      prisma.$executeRaw`INSERT INTO "ApiMetricHourly" ("hour", "route", "count", "errors", "total_ms", "buckets")
        SELECT x.hour, x.route, x.count, x.errors, x.total_ms, x.buckets
        FROM json_to_recordset(${rowsJson}::json) AS x(hour timestamp, route text, count int, errors int, total_ms bigint, buckets int[])
        ON CONFLICT ("hour", "route") DO UPDATE SET
          "count" = "ApiMetricHourly"."count" + EXCLUDED."count",
          "errors" = "ApiMetricHourly"."errors" + EXCLUDED."errors",
          "total_ms" = "ApiMetricHourly"."total_ms" + EXCLUDED."total_ms",
          "buckets" = ARRAY(SELECT a + b FROM unnest("ApiMetricHourly"."buckets", EXCLUDED."buckets") WITH ORDINALITY AS u(a, b, i) ORDER BY i)`,
    ]);
  } catch (error) {
    requeue(rows.filter((r) => r.route !== "db:ping"), daily);
    throw error;
  }
}

// Puts a failed batch back (bounded, so a long outage can't grow memory).
function requeue(rows: Agg[], daily: [string, number][]) {
  if (pending.size > 2000) return;
  for (const r of rows) {
    const key = `${r.hour}|${r.route}`;
    const agg = pending.get(key);
    if (!agg) pending.set(key, r);
    else {
      agg.count += r.count;
      agg.errors += r.errors;
      agg.totalMs += r.totalMs;
      r.buckets.forEach((n, i) => (agg.buckets[i] += n));
    }
  }
  for (const [key, n] of daily) pendingDaily.set(key, (pendingDaily.get(key) ?? 0) + n);
}

// Times an async step (AI inference etc.) into the same histogram.
export async function timed<T>(route: string, task: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    const result = await task();
    observeTiming(route, performance.now() - t0);
    return result;
  } catch (error) {
    observeTiming(route, performance.now() - t0, true);
    throw error;
  }
}
