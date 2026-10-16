import { DEVICE_KINDS, isPageKind, PAGE_KINDS, type DeviceKind, type PageKind } from "./visits";

// 방문 시간·이탈 분석 (운영 통계): how a visit session went -- the screen it
// ended on, how long it lasted, how many screens it saw, the hour of its
// last activity -- kept as anonymous per-day distributions, never as a
// list of sessions or a path per person.
//
// How a session is counted exactly once in each distribution: the browser
// keeps its own session's current state (lib only: first/last screen kind,
// page count, start and last-activity time) and, when it reports, sends the
// change from what it last reported -- "this session moves from bucket A to
// bucket B". The server adds -1 to A and +1 to B in MetricDaily. The first
// report of a session is "init" (+1 everywhere). So at any time each
// distribution holds every reported session once, at its latest known
// state. One report is in flight at a time; the browser marks it sent when
// sending and takes the mark back if the request fails, so the next report
// starts from what the server really has. Not exactly-once: a request the
// server handled but whose reply was lost is sent again (counted twice), and
// one cut off by the page closing is not taken back (that change is lost,
// and the session's buckets can drift by one) -- both rare.
//
// Ends are estimates: a session's end is its last confirmed activity (a
// page view, or input while the tab is visible), not the moment the tab
// closed. A session is "closed" (종료 확인) when the same browser later
// starts a new session (30 minutes idle or a new KST day, the existing
// rule); until then it is open -- still going, or its browser never came
// back (종료 미확인).

export const DURATION_BUCKETS = ["lt10s", "10to30s", "30to60s", "1to3m", "3to5m", "5to10m", "10mplus"] as const;
export type DurationBucket = (typeof DURATION_BUCKETS)[number];
export const DURATION_LABELS: Record<DurationBucket, string> = {
  lt10s: "10초 미만",
  "10to30s": "10~30초",
  "30to60s": "30초~1분",
  "1to3m": "1~3분",
  "3to5m": "3~5분",
  "5to10m": "5~10분",
  "10mplus": "10분 이상",
};
const DURATION_UPPER_S = [10, 30, 60, 180, 300, 600];
export function durationBucket(seconds: number): DurationBucket {
  const i = DURATION_UPPER_S.findIndex((upper) => seconds < upper);
  return DURATION_BUCKETS[i === -1 ? DURATION_BUCKETS.length - 1 : i];
}

export const PAGES_BUCKETS = ["1", "2", "3to4", "5to9", "10plus"] as const;
export type PagesBucket = (typeof PAGES_BUCKETS)[number];
export const PAGES_LABELS: Record<PagesBucket, string> = { "1": "1화면", "2": "2화면", "3to4": "3~4화면", "5to9": "5~9화면", "10plus": "10화면 이상" };
export function pagesBucket(pages: number): PagesBucket {
  return pages <= 1 ? "1" : pages === 2 ? "2" : pages <= 4 ? "3to4" : pages <= 9 ? "5to9" : "10plus";
}

// A session longer than this adds only this much to the duration total (the
// average); its bucket is 10분 이상 either way.
export const MAX_SESSION_SECONDS = 60 * 60;
// Input on a visible page keeps a session's last activity fresh at most this
// often; a background tab or an idle screen adds nothing.
export const ACTIVITY_THROTTLE_MS = 10_000;
// Reports about a session older than this many days are dropped.
export const FLOW_MAX_AGE_DAYS = 7;

export type FlowState = { first: PageKind; exit: PageKind; pages: PagesBucket; dur: DurationBucket; hour: number };
export type FlowUpdate = {
  day: string; // the session's KST day
  init?: true;
  from?: FlowState;
  to: FlowState;
  durSec?: number; // seconds added to this session's duration since the last report
  close?: true; // the browser has started a new session: this one is over
};

// The browser's record of its current session (localStorage).
export type FlowRecord = {
  day: string;
  start: number;
  first: PageKind;
  last: PageKind;
  pages: number;
  active: number; // last confirmed activity
  sent: FlowState | null;
  sentDur: number;
  closed?: true;
};

const kstHour = (ms: number) => new Date(ms + 9 * 3600_000).getUTCHours();

export function sessionSeconds(record: Pick<FlowRecord, "start" | "active">): number {
  return Math.max(0, Math.round((record.active - record.start) / 1000));
}

export function flowStateOf(record: FlowRecord): FlowState {
  return { first: record.first, exit: record.last, pages: pagesBucket(record.pages), dur: durationBucket(sessionSeconds(record)), hour: kstHour(record.active) };
}

const sameState = (a: FlowState, b: FlowState) => a.first === b.first && a.exit === b.exit && a.pages === b.pages && a.dur === b.dur && a.hour === b.hour;

// What to report for a record now (null: nothing changed). The caller marks
// the returned state as sent before sending it.
export function pendingUpdate(record: FlowRecord, close = false): FlowUpdate | null {
  const to = flowStateOf(record);
  const seconds = Math.min(sessionSeconds(record), MAX_SESSION_SECONDS);
  const durSec = Math.max(0, seconds - record.sentDur);
  if (!record.sent) return { day: record.day, init: true, to, ...(durSec ? { durSec } : {}), ...(close ? { close: true } : {}) };
  if (sameState(record.sent, to) && !durSec && !close) return null;
  return { day: record.day, from: record.sent, to, ...(durSec ? { durSec } : {}), ...(close ? { close: true } : {}) };
}

// Does the update move the session between buckets (or open / close it)?
// A report that only adds seconds can wait for the next one: the time is
// kept and goes with it (the mean is the only thing it changes).
export function changesBuckets(update: FlowUpdate): boolean {
  return !!update.init || !!update.close || !update.from || !sameState(update.from, update.to);
}

export function markSent(record: FlowRecord, update: FlowUpdate | null): FlowRecord {
  if (!update) return record;
  return { ...record, sent: update.to, sentDur: record.sentDur + (update.durSec ?? 0), ...(update.close ? { closed: true as const } : {}) };
}

// ---------- server side ----------

const isState = (v: unknown): v is FlowState => {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    isPageKind(s.first) &&
    isPageKind(s.exit) &&
    (PAGES_BUCKETS as readonly unknown[]).includes(s.pages) &&
    (DURATION_BUCKETS as readonly unknown[]).includes(s.dur) &&
    Number.isInteger(s.hour) &&
    (s.hour as number) >= 0 &&
    (s.hour as number) <= 23
  );
};

// A well-formed update about a session of the last FLOW_MAX_AGE_DAYS days.
export function parseFlowUpdate(value: unknown, today: string): FlowUpdate | null {
  if (typeof value !== "object" || value === null) return null;
  const u = value as Record<string, unknown>;
  if (typeof u.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(u.day) || u.day > today) return null;
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${u.day}T00:00:00Z`)) / 86_400_000;
  if (!(age >= 0 && age <= FLOW_MAX_AGE_DAYS)) return null;
  if (!isState(u.to)) return null;
  if (u.init !== true && !isState(u.from)) return null;
  const durSec = typeof u.durSec === "number" && Number.isFinite(u.durSec) ? Math.min(MAX_SESSION_SECONDS, Math.max(0, Math.round(u.durSec))) : 0;
  return {
    day: u.day,
    ...(u.init === true ? { init: true as const } : { from: u.from as FlowState }),
    to: u.to,
    ...(durSec ? { durSec } : {}),
    ...(u.close === true ? { close: true as const } : {}),
  };
}

const hh = (hour: number) => String(hour).padStart(2, "0");
const stateCounters = (s: FlowState, device: DeviceKind): string[] => [
  `visit.flow.exit.${s.exit}.${device}`,
  `visit.flow.path.${s.first}.${s.exit}`,
  `visit.flow.pages.${s.pages}`,
  `visit.flow.dur.${s.dur}.${device}`,
  `visit.flow.endhour.${hh(s.hour)}`,
];

// The MetricDaily changes one update makes ([metric, delta], all on its day).
export function flowCounterChanges(update: FlowUpdate, device: DeviceKind): [string, number][] {
  const changes = new Map<string, number>();
  const add = (metric: string, n: number) => changes.set(metric, (changes.get(metric) ?? 0) + n);
  if (update.init) {
    add(`visit.flow.sessions.${device}`, 1);
    add("visit.flow.open", 1);
  } else if (update.from) {
    for (const m of stateCounters(update.from, device)) add(m, -1);
  }
  for (const m of stateCounters(update.to, device)) add(m, 1);
  if (update.durSec) add(`visit.flow.dursec.${device}`, update.durSec);
  if (update.close) {
    add("visit.flow.open", -1);
    add("visit.flow.closed", 1);
  }
  return [...changes].filter(([, n]) => n !== 0);
}

export { DEVICE_KINDS, PAGE_KINDS };
