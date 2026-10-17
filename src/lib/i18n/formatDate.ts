import { LOCALE_INTL_TAG, type Locale } from "./config";

// A KST date (optionally with time) in the viewer's language, identical on
// the server and in every browser. Client components render it twice --
// on the server, then again while hydrating -- so both must produce the
// same text. Chromium ships without Mongolian date data: there
// Intl.DateTimeFormat("mn-MN") falls back to "2026. 10. 15." while Node and
// WebKit give "2026 оны 10-р сарын 15", and React rejects the mismatch
// (error #418). Mongolian is therefore written out here, in the same form
// Node produces; every other language keeps Intl, whose data browsers have.
export function formatKstDate(date: Date, locale: Locale, { time = false }: { time?: boolean } = {}): string {
  if (locale === "mn") {
    const k = new Date(date.getTime() + 9 * 3_600_000);
    const day = `${k.getUTCFullYear()} оны ${k.getUTCMonth() + 1}-р сарын ${k.getUTCDate()}`;
    if (!time) return day;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${day} ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`;
  }
  return new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], {
    dateStyle: "medium",
    ...(time ? { timeStyle: "short" as const } : {}),
    timeZone: "Asia/Seoul",
  }).format(date);
}
