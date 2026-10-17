// 최근 활동 감지 시각: when a signed-in member's activity is written. Shared
// by the browser beacon (components/layout/ActivityBeacon), which uses it to
// skip calls that would not write anyway, and the server
// (metrics/record.ts recordMemberActivity), which decides. No imports, so
// the client bundle stays free of server code.

// At most one write per member every 5 minutes, plus the first activity of
// each new KST hour (so the hourly active-member count is exact). The real
// last activity can therefore be up to this much later than the stored time.
export const LAST_ACTIVE_INTERVAL_MS = 5 * 60 * 1000;
export const LAST_ACTIVE_INTERVAL_MINUTES = LAST_ACTIVE_INTERVAL_MS / 60_000;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const kstHourKey = (at: Date) => new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(0, 13);

export type ActivityStep = { write: boolean; newDay: boolean; newHour: boolean };

export function activityStep(last: Date | null, now: Date): ActivityStep {
  if (!last) return { write: true, newDay: true, newHour: true };
  // a stored time ahead of this clock is never moved back
  if (now.getTime() <= last.getTime()) return { write: false, newDay: false, newHour: false };
  const a = kstHourKey(last);
  const b = kstHourKey(now);
  const newDay = a.slice(0, 10) !== b.slice(0, 10);
  const newHour = a !== b;
  return { write: newHour || now.getTime() - last.getTime() >= LAST_ACTIVE_INTERVAL_MS, newDay, newHour };
}

// KST "YYYY-MM-DD HH:mm" when a record began here (lastActiveAt; the
// 관리자 활동 log): its marker (KST day + minute of day) or the earliest
// stored time, whichever is earlier.
export function recordingSince(marker: { day: Date; value: number } | null, earliest: Date | null): string | null {
  const fromMarker = marker ? new Date(marker.day.getTime() + marker.value * 60_000 - 9 * 3_600_000) : null;
  const start = [fromMarker, earliest].filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime())[0];
  return start ? new Date(start.getTime() + 9 * 3_600_000).toISOString().slice(0, 16).replace("T", " ") : null;
}
