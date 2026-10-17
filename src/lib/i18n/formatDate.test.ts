import { describe, expect, it } from "vitest";

import { LOCALES, LOCALE_INTL_TAG } from "./config";
import { formatKstDate } from "./formatDate";

const dates = ["2026-10-15T06:30:00Z", "2026-01-05T15:05:00Z", "2026-12-31T14:59:00Z", "2027-02-28T23:00:00Z"].map((d) => new Date(d));

describe("formatKstDate", () => {
  it("writes Mongolian out exactly as Node's ICU does, so server and every browser agree (no React #418)", () => {
    for (const d of dates) {
      for (const time of [false, true]) {
        const intl = new Intl.DateTimeFormat("mn-MN", { dateStyle: "medium", ...(time ? { timeStyle: "short" as const } : {}), timeZone: "Asia/Seoul" }).format(d);
        expect(formatKstDate(d, "mn", { time })).toBe(intl);
      }
    }
    // KST day boundary: 2026-01-05 15:05 UTC is 1월 6일 00:05 KST
    expect(formatKstDate(dates[1], "mn", { time: true })).toBe("2026 оны 1-р сарын 6 00:05");
    // and never the fallback Chromium shows without Mongolian data
    expect(formatKstDate(dates[0], "mn")).not.toBe("2026. 10. 15.");
  });

  it("keeps Intl for every other language, unchanged", () => {
    for (const locale of LOCALES.filter((l) => l !== "mn")) {
      expect(formatKstDate(dates[0], locale)).toBe(new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(dates[0]));
    }
  });
});
