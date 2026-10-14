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
// - Cheap: API timings are aggregated in this instance's memory and written
//   at most once a minute in one statement.

export type DailyMetric =
  | "search.keyword"
  | "search.semantic"
  | "search.image"
  | "recommend.shown";

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
    void run();
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

export function recordDaily(metric: DailyMetric, dedupeParts?: unknown[]): void {
  if (dedupeParts && !firstSeen(signatureOf([metric, ...dedupeParts]))) return;
  const day = kstDay();
  later(() =>
    prisma.$executeRaw`INSERT INTO "MetricDaily" ("day", "metric", "value") VALUES (${day}::date, ${metric}, 1)
      ON CONFLICT ("day", "metric") DO UPDATE SET "value" = "MetricDaily"."value" + 1`,
  );
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
let lastFlush = Date.now();
const FLUSH_EVERY_MS = 60_000;
const FLUSH_AT_OBSERVATIONS = 500;
let observedSinceFlush = 0;

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
  observedSinceFlush += 1;
  if (Date.now() - lastFlush >= FLUSH_EVERY_MS || observedSinceFlush >= FLUSH_AT_OBSERVATIONS) {
    later(flushTimings);
  }
}

export async function flushTimings(): Promise<void> {
  if (pending.size === 0) return;
  const rows = [...pending.values()];
  pending.clear();
  observedSinceFlush = 0;
  lastFlush = Date.now();
  // DB latency, sampled once per flush (not per request).
  const t0 = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const ping = { hour: hourOf(new Date()), route: "db:ping", count: 1, errors: 0, totalMs: Math.round(performance.now() - t0), buckets: new Array(BUCKET_COUNT).fill(0) };
    ping.buckets[bucketOf(ping.totalMs)] = 1;
    rows.push(ping);
  } catch {
    // The upsert below will fail the same way; nothing else to do.
  }
  for (const r of rows) {
    await prisma.$executeRaw`INSERT INTO "ApiMetricHourly" ("hour", "route", "count", "errors", "total_ms", "buckets")
      VALUES (${r.hour}::timestamp, ${r.route}, ${r.count}, ${r.errors}, ${r.totalMs}, ${r.buckets}::int[])
      ON CONFLICT ("hour", "route") DO UPDATE SET
        "count" = "ApiMetricHourly"."count" + EXCLUDED."count",
        "errors" = "ApiMetricHourly"."errors" + EXCLUDED."errors",
        "total_ms" = "ApiMetricHourly"."total_ms" + EXCLUDED."total_ms",
        "buckets" = ARRAY(SELECT a + b FROM unnest("ApiMetricHourly"."buckets", EXCLUDED."buckets") WITH ORDINALITY AS u(a, b, i) ORDER BY i)`;
  }
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
