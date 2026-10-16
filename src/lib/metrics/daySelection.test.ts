import { describe, expect, it } from "vitest";

import {
  addMonths,
  applyRange,
  decodeDays,
  describeDays,
  encodeDays,
  lastDays,
  MAX_SELECTED_DAYS,
  monthGrid,
  resolveSelection,
} from "./daySelection";

const TODAY = "2026-10-23";

describe("시간대 분석 날짜 선택", () => {
  it("follows the example: drag 12~18, click 14 and 16 off, drag 20~23 on", () => {
    let s = applyRange(new Set(), "2026-10-12", "2026-10-18", "add", TODAY);
    expect(s.size).toBe(7);
    s = applyRange(s, "2026-10-14", "2026-10-14", "remove", TODAY);
    s = applyRange(s, "2026-10-16", "2026-10-16", "remove", TODAY);
    s = applyRange(s, "2026-10-23", "2026-10-20", "add", TODAY); // dragged backwards
    expect([...s].sort()).toEqual(["2026-10-12", "2026-10-13", "2026-10-15", "2026-10-17", "2026-10-18", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
    // a drag that starts on a chosen day takes the range away
    s = applyRange(s, "2026-10-12", "2026-10-15", "remove", TODAY);
    expect([...s].sort()[0]).toBe("2026-10-17");
  });

  it("skips days after today and crosses month borders", () => {
    expect([...applyRange(new Set(), "2026-10-22", "2026-10-26", "add", TODAY)].sort()).toEqual(["2026-10-22", "2026-10-23"]);
    expect([...applyRange(new Set(), "2026-09-29", "2026-10-02", "add", TODAY)].sort()).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  });

  it("round-trips the URL form as runs of days", () => {
    const days = ["2026-10-12", "2026-10-13", "2026-10-15", "2026-10-30", "2026-10-31", "2026-11-01"];
    expect(encodeDays(days)).toBe("2026-10-12~2026-10-13,2026-10-15,2026-10-30~2026-11-01");
    expect(decodeDays(encodeDays(days))).toEqual(days);
    expect(decodeDays("2026-10-15,nonsense,2026-02-30,2026-10-13~2026-10-12")).toEqual(["2026-10-12", "2026-10-13", "2026-10-15"]);
    expect(describeDays(days)).toBe("10/12~10/13, 10/15, 10/30~11/1");
    expect(describeDays(["2025-12-31", "2026-01-01"])).toBe("25.12/31~26.1/1");
  });

  it("reads the page's days: the last week by default, none when emptied, never after today, at most 31", () => {
    expect(resolveSelection(null, TODAY)).toEqual({ days: lastDays(TODAY, 7), notice: null });
    expect(resolveSelection(undefined, TODAY).days).toHaveLength(7);
    expect(resolveSelection("", TODAY)).toEqual({ days: [], notice: null });
    expect(resolveSelection("2026-10-22~2026-10-30", TODAY).days).toEqual(["2026-10-22", "2026-10-23"]);
    expect(resolveSelection("2026-09-23~2026-10-23", TODAY).days).toHaveLength(MAX_SELECTED_DAYS);
    const tooMany = resolveSelection("2026-09-01~2026-10-23", TODAY);
    expect(tooMany.days).toHaveLength(MAX_SELECTED_DAYS);
    expect(tooMany.days.at(-1)).toBe(TODAY);
    expect(tooMany.notice).toContain("최대 31일");
    expect(lastDays(TODAY, 30)).toHaveLength(30);
  });

  it("lays a month out Monday first, six weeks, with the neighbouring days", () => {
    const grid = monthGrid("2026-10"); // 10/1 is a Thursday
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-09-28");
    expect(grid[3]).toBe("2026-10-01");
    expect(grid.at(-1)).toBe("2026-11-08");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});
