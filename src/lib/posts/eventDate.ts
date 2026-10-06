// 분실/습득 날짜/시각 분리: a post's 분실/습득 시점 is two columns --
// lostDate/foundDate (the KST calendar date, a Postgres DATE) and
// lostAt/foundAt (the exact instant, set only when the time is known):
//
//   날짜+시간 앎 -> date + instant
//   날짜만 앎     -> date only, instant null (never a made-up 00:00/12:00)
//   날짜도 모름   -> both null
//
// A date travels as a "YYYY-MM-DD" string everywhere outside the DB (API,
// DTO, form) so no time zone conversion can ever move it to a neighboring
// day. Prisma maps a DATE column to a Date at UTC midnight of that day;
// dateOnlyToDb/dbDateToDateOnly are the only two places that representation
// is touched. Pure functions only, so server and client can both import it.

import { kstDateOnly, kstStartOfDay } from "./eventPeriod";

const TIME_ONLY = /^([01]\d|2[0-3]):[0-5]\d$/;

// "YYYY-MM-DD" -> the Date Prisma reads/writes for that DATE value.
export function dateOnlyToDb(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

// The inverse: a DATE column value (UTC midnight) -> "YYYY-MM-DD".
export function dbDateToDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isValidDateOnly(value: string): boolean {
  return kstStartOfDay(value) !== null;
}

export function isValidTimeOnly(value: string): boolean {
  return TIME_ONLY.test(value);
}

// A KST date + "HH:mm" KST wall-clock time -> that exact instant.
export function kstInstantFromParts(dateOnly: string, time: string): Date {
  return new Date(`${dateOnly}T${time}:00+09:00`);
}

// An instant -> its KST "HH:mm" (edit-form prefill of the time input).
export function kstTimeOnly(instant: Date): string {
  return new Date(instant.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

type EventFields =
  | { type: "lost"; lostAt: Date | null; lostDate?: string | null }
  | { type: "found"; foundAt: Date | null; foundDate?: string | null };

// A post's 분실/습득 시점 for display and the edit form: the KST date and
// time ("HH:mm", only when the exact instant is known). A post that has an
// instant but no date column value (written before the date column
// existed and not backfilled) still shows that instant's KST date.
export function postEventDateTime(post: EventFields): { at: Date | null; date: string | null; time: string | null } {
  const at = post.type === "lost" ? post.lostAt : post.foundAt;
  const date = (post.type === "lost" ? post.lostDate : post.foundDate) ?? null;
  return { at, date: date ?? (at ? kstDateOnly(at) : null), time: at ? kstTimeOnly(at) : null };
}
