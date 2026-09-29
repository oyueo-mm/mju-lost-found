// 기간 검색 필터 (분실/습득 시점 기준): resolves the URL's `period`/`from`/
// `to` into the instant range a search filters lostAt (LostPost) /
// foundAt (FoundPost) by -- never createdAt. Day boundaries are Korea
// Standard Time (fixed +09:00, no DST), the same timezone every screen
// shows these times in (see kstDateTime.ts). Pure, so both the query schema
// and the UI can use it.
//
//   today  -> today 00:00 .. today 23:59:59.999 (KST)
//   3d     -> 2 days ago 00:00 .. today end   (today counts as day 1)
//   1w     -> 6 days ago 00:00 .. today end
//   1m     -> 29 days ago 00:00 .. today end  (30 calendar days)
//   custom -> from 00:00 .. to 23:59:59.999 (KST); either end may be open

export const EVENT_PERIODS = ["today", "3d", "1w", "1m", "custom"] as const;
export type EventPeriod = (typeof EVENT_PERIODS)[number];

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const PRESET_DAYS: Record<Exclude<EventPeriod, "custom">, number> = { today: 1, "3d": 3, "1w": 7, "1m": 30 };

export type EventRange = { from?: Date; to?: Date };

// "YYYY-MM-DD" -> that KST day's first instant (00:00:00.000 KST), or null
// if it isn't a real calendar date (e.g. 2026-02-30).
export function kstStartOfDay(dateOnly: string): Date | null {
  if (!DATE_ONLY.test(dateOnly)) return null;
  const d = new Date(`${dateOnly}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return null;
  // Reject rollovers like 2026-02-30 -> 2026-03-02.
  return kstDateOnly(d) === dateOnly ? d : null;
}

// Last instant of that KST day (23:59:59.999 KST).
export function kstEndOfDay(dateOnly: string): Date | null {
  const start = kstStartOfDay(dateOnly);
  return start ? new Date(start.getTime() + DAY_MS - 1) : null;
}

// The KST calendar date ("YYYY-MM-DD") an instant falls on.
export function kstDateOnly(instant: Date): string {
  return new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// null = no period filter (전체). A custom period with neither end set is
// also "no filter". Callers validate from/to format and ordering first (see
// posts/schema.ts); an unparseable end is simply left open here.
export function resolveEventRange(
  { period, from, to }: { period?: EventPeriod; from?: string; to?: string },
  now: Date = new Date(),
): EventRange | null {
  if (!period) return null;
  if (period === "custom") {
    const range: EventRange = {};
    const start = from ? kstStartOfDay(from) : null;
    const end = to ? kstEndOfDay(to) : null;
    if (start) range.from = start;
    if (end) range.to = end;
    return range.from || range.to ? range : null;
  }
  const today = kstDateOnly(now);
  const todayStart = kstStartOfDay(today)!;
  return {
    from: new Date(todayStart.getTime() - (PRESET_DAYS[period] - 1) * DAY_MS),
    to: new Date(todayStart.getTime() + DAY_MS - 1),
  };
}
