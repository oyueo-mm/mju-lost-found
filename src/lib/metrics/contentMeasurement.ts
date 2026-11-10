// A release namespace, not a URL/campaign version. Never reuse the legacy keys.
import { PRODUCTION_HOST } from "../devstats/vercelDeployment.mjs";

// A candidate deployment's unique URL must not establish the live boundary.
export function isContentCollectionHost(host: string | null, environment: string | undefined): boolean {
  return environment !== "production" || host?.toLowerCase() === PRODUCTION_HOST || host?.toLowerCase() === `${PRODUCTION_HOST}:443`;
}
export const CONTENT_EPOCH = "v1";
export const CONTENT_PREFIX = "visit.utm_content_v1.";
export const CONTENT_PAIR_PREFIX = "visit.utm_pair_v1.";
export const CONTENT_FIRST = "meta.first.utm_content_v1";
export type ContentObservation = { day: string; second: number };
export type ContentRows = { contents: { value: string; sessions: number }[]; pairs: { campaign: string; content: string; sessions: number }[] };
export type ContentReport = ContentRows & {
  epoch: string; since: string | null; firstObservedAt: string | null; measuredDays: number;
  perDay: { day: string; coverage: "none" | "partial"; taggedSessions: number | null }[];
};

export function observationTime(first: ContentObservation | null): string | null {
  if (!first || !/^\d{4}-\d{2}-\d{2}$/.test(first.day) || !Number.isInteger(first.second) || first.second < 0 || first.second >= 86400) return null;
  const calendar = new Date(`${first.day}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== first.day) return null;
  const hh = String(Math.floor(first.second / 3600)).padStart(2, "0");
  const mm = String(Math.floor(first.second / 60) % 60).padStart(2, "0");
  const ss = String(first.second % 60).padStart(2, "0");
  const value = `${first.day}T${hh}:${mm}:${ss}+09:00`;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

type Row = { day: string; metric: string; n: number };
export function contentRows(rows: Row[], contentPrefix: string, pairPrefix: string): ContentRows {
  const contents = new Map<string, number>();
  const pairs = new Map<string, { campaign: string; content: string; sessions: number }>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.n) || row.n < 0) continue;
    if (row.metric.startsWith(contentPrefix)) {
      const content = row.metric.slice(contentPrefix.length);
      if (/^[a-z0-9_-]+$/.test(content)) contents.set(content, (contents.get(content) ?? 0) + row.n);
    } else if (row.metric.startsWith(pairPrefix)) {
      const key = row.metric.slice(pairPrefix.length);
      const match = /^([a-z0-9_-]+)\.([a-z0-9_-]+)$/.exec(key);
      if (!match) continue;
      const pair = pairs.get(key) ?? { campaign: match[1], content: match[2], sessions: 0 };
      pair.sessions += row.n; pairs.set(key, pair);
    }
  }
  return {
    contents: [...contents].map(([value, sessions]) => ({ value, sessions })).sort((a, b) => b.sessions - a.sessions || a.value.localeCompare(b.value)),
    pairs: [...pairs.values()].sort((a, b) => b.sessions - a.sessions || a.campaign.localeCompare(b.campaign) || a.content.localeCompare(b.content)),
  };
}

export function buildContentMeasurement(days: string[], rows: Row[], first: ContentObservation | null): ContentReport {
  const firstObservedAt = observationTime(first);
  const since = firstObservedAt ? first!.day : null;
  const observed = new Set(rows.filter(r => r.metric === CONTENT_FIRST && observationTime({ day: r.day, second: r.n }) && since && r.day >= since).map(r => r.day));
  const selected = new Set(days);
  const eligible = rows.filter(r => selected.has(r.day) && observed.has(r.day));
  const dailyTotals = new Map<string, number>();
  for (const r of eligible) {
    if (r.metric.startsWith(CONTENT_PREFIX) && /^[a-z0-9_-]+$/.test(r.metric.slice(CONTENT_PREFIX.length)) && Number.isSafeInteger(r.n) && r.n >= 0) {
      dailyTotals.set(r.day, (dailyTotals.get(r.day) ?? 0) + r.n);
    }
  }
  return {
    epoch: CONTENT_EPOCH, since, firstObservedAt, measuredDays: days.filter(day => observed.has(day)).length,
    ...contentRows(eligible, CONTENT_PREFIX, CONTENT_PAIR_PREFIX),
    // A daily observation is evidence of collection, not proof of all-day uptime.
    // In particular, same-day rollback gaps must never become a "full" day.
    perDay: days.map(day => ({ day, coverage: observed.has(day) ? "partial" : "none", taggedSessions: observed.has(day)
      ? dailyTotals.get(day) ?? 0 : null })),
  };
}
