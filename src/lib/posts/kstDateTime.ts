// <input type="datetime-local"> values ("YYYY-MM-DDTHH:mm", no timezone)
// for a post's 분실/습득 일시 are always Korea Standard Time wall-clock
// times -- the same timezone every screen of this app displays them in
// (see post/[id]/page.tsx's formatDate: "타임존은 언제나 Asia/Seoul"),
// regardless of the server's timezone (UTC on Vercel) or the browser's.
//
// Before this module the server parsed that string with the *server's*
// local timezone, so on Vercel "14:00" was stored as 14:00 UTC and shown on
// the detail page as 23:00 KST, while the edit page (also formatting in the
// server's timezone) showed 14:00 again and hid the error. Korea has no
// daylight saving time, so a fixed +09:00 offset is exact.
//
// Pure functions only, so both the server (schema, edit page) and the
// client (PostForm's default "now") can import this.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DATE_TIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/;

// For a zod preprocess step: a timezone-less datetime-local string becomes
// the Date for that KST wall-clock time. Anything else -- null (시간 모름),
// a Date, or a string that already carries "Z"/an offset -- is passed
// through unchanged for the schema's own validation.
export function interpretDateTimeLocalAsKst(value: unknown): unknown {
  if (typeof value !== "string" || !DATE_TIME_LOCAL.test(value)) return value;
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  return new Date(`${withSeconds}+09:00`);
}

// Date -> the "YYYY-MM-DDTHH:mm" KST wall-clock value a datetime-local input
// expects (edit-page prefill).
export function toKstDateTimeLocalValue(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 16);
}

// The current KST time as a datetime-local value (create-form default).
export function nowAsKstDateTimeLocalValue(): string {
  return toKstDateTimeLocalValue(new Date());
}
